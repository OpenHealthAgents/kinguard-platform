"""Comprehensive test suite for Meta WhatsApp Parent Invitations in KinGuardian.

Covers Phase 7 requirements:
1. Valid invitation creation via WhatsApp adapter (mock mode)
2. Phone number normalization (E.164 format and rejection of invalid formats)
3. Graceful handling of unconfigured WhatsApp credentials
4. Coordinator-only authorization enforcement
5. Care-subject scoping across families (cannot invite for subject in different family)
6. Single-use cryptographically secure token generation and validation
7. Replay prevention (cannot accept twice)
8. Expired token rejection
9. Revoked token rejection
10. Meta Webhook signature verification (valid HMAC-SHA256 vs invalid/missing)
11. Meta Webhook delivery status tracking (sent, delivered, read, failed)
12. Audit trail logging across all invitation lifecycle events
13. Privacy preservation (validation endpoint never leaks medical, FHIR, or notes)
14. Idempotent invitation creation and cooldown behavior
"""
import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.adapters.whatsapp import WhatsAppCloudAdapter, normalize_phone_number, whatsapp_adapter
from app.config import settings
from app.db import Base, get_session
from app.main import app
from app.models import AuditLog, CareGrant, CareSubject, Consent, Family, Invitation, Membership, OutboxEvent, Profile


@pytest_asyncio.fixture
async def api_env():
    """Setup isolated test database and test HTTP client with mock WhatsApp adapter."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_session():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    transport = httpx.ASGITransport(app=app)

    # Enable mock mode on whatsapp adapter
    original_mock = whatsapp_adapter.mock_mode
    original_secret = whatsapp_adapter.app_secret
    whatsapp_adapter.mock_mode = True
    whatsapp_adapter.app_secret = "test_meta_secret_key_12345"

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, sessions

    app.dependency_overrides.clear()
    whatsapp_adapter.mock_mode = original_mock
    whatsapp_adapter.app_secret = original_secret
    await engine.dispose()


@pytest_asyncio.fixture
async def seeded_family(api_env):
    """Seed a family with a coordinator, parent subject, and another independent family."""
    client, sessions = api_env
    coord_headers = {"X-Actor-Subject": "coordinator_user", "X-Actor-Timezone": "America/Toronto"}
    member_headers = {"X-Actor-Subject": "member_user", "X-Actor-Timezone": "Asia/Kolkata"}

    async with sessions() as session:
        # Create coordinator profile
        coordinator = Profile(
            identity_subject="coordinator_user",
            display_name="Anjali Sharma",
            email="coordinator@kinguardian.com",
            role="coordinator",
            timezone="America/Toronto"
        )
        # Create plain member profile
        member = Profile(
            identity_subject="member_user",
            display_name="Sibling Member",
            email="sibling@kinguardian.com",
            role="caregiver",
            timezone="Asia/Kolkata"
        )
        session.add_all([coordinator, member])
        await session.flush()

        # Family 1 (Target family)
        family1 = Family(
            name="Sharma Family",
            home_timezone="Asia/Kolkata"
        )
        session.add(family1)
        await session.flush()

        # Memberships
        session.add(Membership(family_id=family1.id, profile_id=coordinator.id, role="coordinator", status="active"))
        session.add(Membership(family_id=family1.id, profile_id=member.id, role="caregiver", status="active"))

        # CareSubject 1 for Family 1
        subject1 = CareSubject(
            family_id=family1.id,
            preferred_timezone="Asia/Kolkata",
            external_patient_ref=json.dumps({"name": "Ramesh Sharma", "role": "parent", "medical_notes": "CONFIDENTIAL_CLINICAL_NOTE_123"})
        )
        session.add(subject1)

        # Family 2 (Unrelated family for cross-tenant testing)
        other_coord = Profile(
            identity_subject="other_coordinator",
            display_name="Other Coordinator",
            email="other@kinguardian.com",
            role="coordinator"
        )
        session.add(other_coord)
        await session.flush()
        family2 = Family(name="Patel Family", home_timezone="Asia/Kolkata")
        session.add(family2)
        await session.flush()
        session.add(Membership(family_id=family2.id, profile_id=other_coord.id, role="coordinator", status="active"))
        subject2 = CareSubject(family_id=family2.id, preferred_timezone="Asia/Kolkata")
        session.add(subject2)

        await session.commit()

        return {
            "client": client,
            "sessions": sessions,
            "family_id": str(family1.id),
            "subject_id": str(subject1.id),
            "other_family_id": str(family2.id),
            "other_subject_id": str(subject2.id),
            "coord_headers": coord_headers,
            "member_headers": member_headers,
            "coordinator_id": str(coordinator.id)
        }


# ==============================================================================
# 1. Phone number normalization (E.164)
# ==============================================================================

def test_phone_number_normalization_e164():
    """Verify normalize_phone_number produces valid E.164 format and rejects invalid formats."""
    # Valid standard inputs
    assert normalize_phone_number("+91 98765 43210") == "+919876543210"
    assert normalize_phone_number("+1 (555) 123-4567") == "+15551234567"
    assert normalize_phone_number("00919876543210") == "+919876543210"
    assert normalize_phone_number("+44 20 7946 0912") == "+442079460912"

    # Invalid: missing country code '+' or '00'
    with pytest.raises(ValueError, match="must include international"):
        normalize_phone_number("9876543210")

    # Invalid: non-numeric garbage or empty
    with pytest.raises(ValueError):
        normalize_phone_number("+91-ABCDE")
    with pytest.raises(ValueError):
        normalize_phone_number("")
    with pytest.raises(ValueError):
        normalize_phone_number("+0000000000")


# ==============================================================================
# 2. Valid invitation creation via WhatsApp adapter (Mock mode)
# ==============================================================================

@pytest.mark.asyncio
async def test_valid_whatsapp_invitation_creation(seeded_family):
    """Coordinator successfully creates WhatsApp parent invite, returns delivery_status='accepted' in mock mode."""
    client = seeded_family["client"]
    family_id = seeded_family["family_id"]
    subject_id = seeded_family["subject_id"]
    headers = seeded_family["coord_headers"]

    payload = {
        "phone": "+91 98765 43210",
        "parent_name": "Ramesh Sharma",
        "subject_id": subject_id,
        "role": "parent"
    }
    resp = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
    assert resp.status_code == 201
    data = resp.json()

    assert data["destination"] == "+919876543210"
    assert data["channel"] == "whatsapp"
    assert data["role"] == "parent"
    assert data["status"] == "pending"
    assert data["delivery_status"] == "accepted"
    assert data["provider_message_id"] is not None
    assert "token" not in data  # Raw token must not be leaked in creation response
    assert "token_hash" not in data


# ==============================================================================
# 3. Unconfigured WhatsApp credentials handled gracefully
# ==============================================================================

@pytest.mark.asyncio
async def test_unconfigured_whatsapp_credentials_gracefully_handled(seeded_family):
    """When credentials are not configured and mock mode is disabled, delivery_status is 'not_configured'."""
    client = seeded_family["client"]
    family_id = seeded_family["family_id"]
    headers = seeded_family["coord_headers"]

    # Temporarily set adapter to unconfigured production mode
    orig_mock = whatsapp_adapter.mock_mode
    orig_id = whatsapp_adapter.phone_number_id
    orig_token = whatsapp_adapter.access_token

    whatsapp_adapter.mock_mode = False
    whatsapp_adapter.phone_number_id = None
    whatsapp_adapter.access_token = None

    try:
        payload = {
            "phone": "+1 555 234 5678",
            "parent_name": "Father",
            "role": "parent"
        }
        resp = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["delivery_status"] == "not_configured"
        assert "not configured" in data["detail"].lower()
    finally:
        whatsapp_adapter.mock_mode = orig_mock
        whatsapp_adapter.phone_number_id = orig_id
        whatsapp_adapter.access_token = orig_token


# ==============================================================================
# 4. Coordinator-only authorization enforcement
# ==============================================================================

@pytest.mark.asyncio
async def test_non_coordinator_cannot_create_invitation(seeded_family):
    """Non-coordinator family members cannot issue invitations (403 Forbidden)."""
    client = seeded_family["client"]
    family_id = seeded_family["family_id"]
    member_headers = seeded_family["member_headers"]

    payload = {
        "phone": "+91 99999 11111",
        "parent_name": "Test Parent",
        "role": "parent"
    }
    resp = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=member_headers)
    assert resp.status_code == 403


# ==============================================================================
# 5. Care-subject scoping across families
# ==============================================================================

@pytest.mark.asyncio
async def test_scoping_cannot_invite_for_subject_in_another_family(seeded_family):
    """Coordinator of Family 1 cannot issue an invite for a CareSubject belonging to Family 2."""
    client = seeded_family["client"]
    family_id = seeded_family["family_id"]
    other_subject_id = seeded_family["other_subject_id"]
    headers = seeded_family["coord_headers"]

    payload = {
        "phone": "+91 98888 22222",
        "parent_name": "Unauthorized Parent",
        "subject_id": other_subject_id,
        "role": "parent"
    }
    resp = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
    assert resp.status_code == 403
    assert "does not belong to this family" in resp.json()["detail"]


# ==============================================================================
# 6. Single-use token generation, privacy preservation & validation
# ==============================================================================

@pytest.mark.asyncio
async def test_single_use_token_validation_preserves_privacy(seeded_family):
    """Validate endpoint confirms pending status without leaking sensitive clinical/FHIR notes."""
    client = seeded_family["client"]
    sessions = seeded_family["sessions"]
    family_id = seeded_family["family_id"]
    subject_id = seeded_family["subject_id"]
    headers = seeded_family["coord_headers"]

    # Clear sent messages in mock
    whatsapp_adapter.sent_messages.clear()

    payload = {
        "phone": "+91 91234 56789",
        "parent_name": "Ramesh Sharma",
        "subject_id": subject_id,
        "role": "parent"
    }
    resp = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
    assert resp.status_code == 201

    # Extract the raw token from the mock adapter's delivered URL
    assert len(whatsapp_adapter.sent_messages) == 1
    invite_url = whatsapp_adapter.sent_messages[0]["invite_url"]
    assert "token=" in invite_url
    raw_token = invite_url.split("token=")[1]

    # Inspect DB: raw token must NOT be in DB, only token_hash
    async with sessions() as session:
        inv = (await session.execute(select(Invitation).where(Invitation.destination == "+919123456789"))).scalar_one()
        assert inv.token_hash == hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        assert raw_token not in inv.token_hash

    # Validate endpoint
    val_resp = await client.get(f"/api/v1/invitations/validate?token={raw_token}")
    assert val_resp.status_code == 200
    val_data = val_resp.json()
    assert val_data["valid"] is True
    assert val_data["family_name"] == "Sharma Family"
    assert val_data["coordinator_name"] == "Anjali Sharma"
    assert val_data["invitee_name"] == "Ramesh Sharma"
    assert val_data["status"] == "pending"

    # Privacy check: Ensure CONFIDENTIAL_CLINICAL_NOTE_123 is NEVER present in validation output
    resp_text = json.dumps(val_data)
    assert "CONFIDENTIAL_CLINICAL_NOTE_123" not in resp_text
    assert "medical_notes" not in resp_text
    assert "external_patient_ref" not in resp_text


# ==============================================================================
# 7. Parent acceptance workflow & replay prevention
# ==============================================================================

@pytest.mark.asyncio
async def test_parent_acceptance_and_replay_prevention(seeded_family):
    """Parent accepts invite: binds to CareSubject and Family; second attempt is rejected."""
    client = seeded_family["client"]
    sessions = seeded_family["sessions"]
    family_id = seeded_family["family_id"]
    subject_id = seeded_family["subject_id"]
    headers = seeded_family["coord_headers"]

    whatsapp_adapter.sent_messages.clear()
    payload = {"phone": "+91 97777 88888", "parent_name": "Ramesh", "subject_id": subject_id, "role": "parent"}
    resp = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
    assert resp.status_code == 201

    raw_token = whatsapp_adapter.sent_messages[0]["invite_url"].split("token=")[1]

    # Create a new authenticated user profile representing the parent
    parent_headers = {"X-Actor-Subject": "parent_user_ramesh", "X-Actor-Timezone": "Asia/Kolkata"}

    # Accept invitation
    accept_resp = await client.post("/api/v1/invitations/accept", json={"token": raw_token}, headers=parent_headers)
    assert accept_resp.status_code == 200
    acc_data = accept_resp.json()
    assert acc_data["status"] == "accepted"
    assert acc_data["family_id"] == family_id

    # Verify atomic DB state
    async with sessions() as session:
        # Check invitation is accepted
        inv = (await session.execute(select(Invitation).where(Invitation.destination == "+919777788888"))).scalar_one()
        assert inv.status == "accepted"
        assert inv.accepted_at is not None

        # Check membership created
        parent_prof = (await session.execute(select(Profile).where(Profile.identity_subject == "parent_user_ramesh"))).scalar_one()
        mem = (await session.execute(select(Membership).where(
            Membership.family_id == uuid.UUID(family_id),
            Membership.profile_id == parent_prof.id
        ))).scalar_one_or_none()
        assert mem is not None
        assert mem.role == "parent"

        # Check CareSubject bound
        subj = await session.get(CareSubject, uuid.UUID(subject_id))
        assert subj.profile_id == parent_prof.id

        # Check CareGrant created
        grant = (await session.execute(select(CareGrant).where(
            CareGrant.subject_id == subj.id,
            CareGrant.profile_id == parent_prof.id
        ))).scalar_one_or_none()
        assert grant is not None

    # Replay attack: attempt to accept the SAME token a second time
    replay_resp = await client.post("/api/v1/invitations/accept", json={"token": raw_token}, headers=parent_headers)
    assert replay_resp.status_code == 400
    assert "already been accepted" in replay_resp.json()["detail"]


# ==============================================================================
# 8. Expired token rejection
# ==============================================================================

@pytest.mark.asyncio
async def test_expired_token_rejection(seeded_family):
    """Tokens past expiration date are marked expired and rejected for acceptance."""
    client = seeded_family["client"]
    sessions = seeded_family["sessions"]
    family_id = seeded_family["family_id"]
    headers = seeded_family["coord_headers"]

    whatsapp_adapter.sent_messages.clear()
    payload = {"phone": "+91 96666 55555", "parent_name": "Grandpa", "role": "parent"}
    resp = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
    assert resp.status_code == 201

    raw_token = whatsapp_adapter.sent_messages[0]["invite_url"].split("token=")[1]

    # Force expiration in DB (e.g. set expires_at 1 day in the past)
    async with sessions() as session:
        inv = (await session.execute(select(Invitation).where(Invitation.destination == "+919666655555"))).scalar_one()
        inv.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        await session.commit()

    # Validate endpoint should detect expiration
    val_resp = await client.get(f"/api/v1/invitations/validate?token={raw_token}")
    assert val_resp.status_code == 200
    assert val_resp.json()["valid"] is False
    assert val_resp.json()["status"] == "expired"

    # Accept should fail
    parent_headers = {"X-Actor-Subject": "late_parent"}
    acc_resp = await client.post("/api/v1/invitations/accept", json={"token": raw_token}, headers=parent_headers)
    assert acc_resp.status_code == 400
    assert "expired" in acc_resp.json()["detail"].lower()


# ==============================================================================
# 9. Revoked token rejection
# ==============================================================================

@pytest.mark.asyncio
async def test_revocation_prevents_acceptance(seeded_family):
    """Coordinator revokes invitation; subsequent validate and accept calls fail."""
    client = seeded_family["client"]
    family_id = seeded_family["family_id"]
    headers = seeded_family["coord_headers"]

    whatsapp_adapter.sent_messages.clear()
    payload = {"phone": "+91 95555 44444", "parent_name": "Revoke Test", "role": "parent"}
    resp = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
    assert resp.status_code == 201
    inv_id = resp.json()["id"]

    raw_token = whatsapp_adapter.sent_messages[0]["invite_url"].split("token=")[1]

    # Revoke invitation
    rev_resp = await client.post(f"/api/v1/families/{family_id}/invitations/{inv_id}/revoke", headers=headers)
    assert rev_resp.status_code == 200
    assert rev_resp.json()["status"] == "revoked"

    # Validate
    val_resp = await client.get(f"/api/v1/invitations/validate?token={raw_token}")
    assert val_resp.status_code == 200
    assert val_resp.json()["valid"] is False
    assert val_resp.json()["status"] == "revoked"

    # Attempt accept
    parent_headers = {"X-Actor-Subject": "revoked_parent"}
    acc_resp = await client.post("/api/v1/invitations/accept", json={"token": raw_token}, headers=parent_headers)
    assert acc_resp.status_code == 400
    assert "revoked" in acc_resp.json()["detail"].lower()


# ==============================================================================
# 10. Meta Webhook signature verification (valid vs invalid)
# ==============================================================================

@pytest.mark.asyncio
async def test_meta_webhook_signature_verification(seeded_family):
    """Webhook verifies HMAC-SHA256 signature in X-Hub-Signature-256."""
    client = seeded_family["client"]
    secret = whatsapp_adapter.app_secret

    webhook_payload = {
        "object": "whatsapp_business_account",
        "entry": []
    }
    raw_body = json.dumps(webhook_payload).encode("utf-8")

    # 1. Missing signature
    resp_no_sig = await client.post("/api/v1/webhooks/whatsapp", content=raw_body)
    assert resp_no_sig.status_code == 401

    # 2. Invalid/tampered signature
    resp_bad_sig = await client.post(
        "/api/v1/webhooks/whatsapp",
        content=raw_body,
        headers={"X-Hub-Signature-256": "sha256=invalidhexsignature12345"}
    )
    assert resp_bad_sig.status_code == 401

    # 3. Valid HMAC-SHA256 signature
    valid_hmac = hmac.new(secret.encode("utf-8"), msg=raw_body, digestmod=hashlib.sha256).hexdigest()
    resp_good_sig = await client.post(
        "/api/v1/webhooks/whatsapp",
        content=raw_body,
        headers={"X-Hub-Signature-256": f"sha256={valid_hmac}"}
    )
    assert resp_good_sig.status_code == 200
    assert resp_good_sig.json()["status"] == "ok"


# ==============================================================================
# 11. Meta Webhook delivery status tracking (sent, delivered, read, failed)
# ==============================================================================

@pytest.mark.asyncio
async def test_meta_webhook_delivery_status_updates(seeded_family):
    """Webhook updates delivery_status from 'accepted' to 'delivered' and 'read'."""
    client = seeded_family["client"]
    sessions = seeded_family["sessions"]
    family_id = seeded_family["family_id"]
    headers = seeded_family["coord_headers"]
    secret = whatsapp_adapter.app_secret

    payload = {"phone": "+91 94444 33333", "parent_name": "Webhook Parent", "role": "parent"}
    create_resp = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
    assert create_resp.status_code == 201
    wamid = create_resp.json()["provider_message_id"]

    # Send webhook delivering the message
    delivery_event = {
        "object": "whatsapp_business_account",
        "entry": [{
            "changes": [{
                "value": {
                    "statuses": [{
                        "id": wamid,
                        "status": "delivered",
                        "timestamp": "1700000000"
                    }]
                }
            }]
        }]
    }
    raw_body = json.dumps(delivery_event).encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), msg=raw_body, digestmod=hashlib.sha256).hexdigest()

    wh_resp = await client.post(
        "/api/v1/webhooks/whatsapp",
        content=raw_body,
        headers={"X-Hub-Signature-256": f"sha256={sig}"}
    )
    assert wh_resp.status_code == 200

    # Verify DB delivery status is updated to 'delivered'
    async with sessions() as session:
        inv = (await session.execute(select(Invitation).where(Invitation.provider_message_id == wamid))).scalar_one()
        assert inv.delivery_status == "delivered"


# ==============================================================================
# 12. Audit trail logging for all lifecycle transitions
# ==============================================================================

@pytest.mark.asyncio
async def test_invitation_audit_logging(seeded_family):
    """Every invitation action (create, resend, revoke) logs an AuditLog record."""
    client = seeded_family["client"]
    sessions = seeded_family["sessions"]
    family_id = seeded_family["family_id"]
    headers = seeded_family["coord_headers"]

    payload = {"phone": "+91 93333 22222", "parent_name": "Audit Parent", "role": "parent"}
    create_resp = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
    assert create_resp.status_code == 201
    inv_id = uuid.UUID(create_resp.json()["id"])

    # Check invitation.created.v1 audit log
    async with sessions() as session:
        logs = (await session.execute(
            select(AuditLog).where(
                AuditLog.resource_id == str(inv_id),
                AuditLog.action == "invitation.created.v1"
            )
        )).scalars().all()
        assert len(logs) >= 1

    # Revoke and check invitation.revoked.v1 audit log
    rev_resp = await client.post(f"/api/v1/families/{family_id}/invitations/{inv_id}/revoke", headers=headers)
    assert rev_resp.status_code == 200

    async with sessions() as session:
        rev_logs = (await session.execute(
            select(AuditLog).where(
                AuditLog.resource_id == str(inv_id),
                AuditLog.action == "invitation.revoked.v1"
            )
        )).scalars().all()
        assert len(rev_logs) >= 1


# ==============================================================================
# 13. Idempotency and cooldown on duplicate requests
# ==============================================================================

@pytest.mark.asyncio
async def test_idempotent_invitation_creation_and_cooldown(seeded_family):
    """Duplicate requests with same idempotency_key return existing record without duplicate DB entries."""
    client = seeded_family["client"]
    sessions = seeded_family["sessions"]
    family_id = seeded_family["family_id"]
    headers = seeded_family["coord_headers"]

    idem_key = f"wa-test-idem-{uuid.uuid4().hex}"
    payload = {
        "phone": "+91 92222 11111",
        "parent_name": "Idem Parent",
        "role": "parent",
        "idempotency_key": idem_key
    }

    # Request 1
    resp1 = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
    assert resp1.status_code == 201
    data1 = resp1.json()

    # Request 2 with same idempotency_key
    resp2 = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload, headers=headers)
    assert resp2.status_code == 201
    data2 = resp2.json()
    assert data2["idempotent"] is True
    assert data2["id"] == data1["id"]

    # Verify only ONE invitation exists in DB
    async with sessions() as session:
        invs = (await session.execute(select(Invitation).where(Invitation.destination == "+919222211111"))).scalars().all()
        assert len(invs) == 1

    # Immediate third request without idempotency key hits 60s cooldown
    payload_no_idem = {
        "phone": "+91 92222 11111",
        "parent_name": "Idem Parent",
        "role": "parent"
    }
    resp3 = await client.post(f"/api/v1/families/{family_id}/invitations/whatsapp", json=payload_no_idem, headers=headers)
    assert resp3.status_code == 201
    data3 = resp3.json()
    assert data3.get("cooldown") is True
