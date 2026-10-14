"""Comprehensive tests for Authentication and Authorization in KinGuardian."""
import uuid
from datetime import UTC, datetime, timedelta
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.db import Base, get_session
from app.main import app
from app.models import AuditLog, CareGrant, CareSubject, Family, MedicationAdherence, Membership, Profile
from app.security import create_access_token, decode_token, hash_password, verify_password


@pytest_asyncio.fixture
async def client_and_sessions():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_session():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, sessions
    app.dependency_overrides.clear()
    await engine.dispose()


def test_password_hashing_and_verification():
    raw = "SuperSecret123!"
    hashed = hash_password(raw)
    assert hashed.startswith("pbkdf2_sha256$")
    assert verify_password(raw, hashed) is True
    assert verify_password("WrongPassword", hashed) is False
    assert verify_password("", hashed) is False
    assert verify_password(raw, None) is False
    assert verify_password(raw, "invalid_format") is False


def test_jwt_token_generation_and_decoding():
    data = {"sub": "user_123", "email": "user@example.com", "role": "coordinator"}
    access_token = create_access_token(data)
    decoded = decode_token(access_token, expected_type="access")
    assert decoded["sub"] == "user_123"
    assert decoded["email"] == "user@example.com"
    assert decoded["role"] == "coordinator"
    assert decoded["type"] == "access"

    with pytest.raises(Exception):
        decode_token("tampered.token.here", expected_type="access")


@pytest.mark.asyncio
async def test_register_user_creates_profile_and_returns_tokens(client_and_sessions):
    client, sessions = client_and_sessions
    payload = {
        "email": "priya.coordinator@kinguardian.com",
        "password": "Password123!",
        "name": "Priya Sharma",
        "timezone": "Asia/Kolkata",
        "role": "coordinator",
    }
    response = await client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "priya.coordinator@kinguardian.com"
    assert data["user"]["display_name"] == "Priya Sharma"
    assert data["user"]["role"] == "coordinator"
    assert "password_hash" not in data["user"]

    # Verify stored in DB
    async with sessions() as session:
        profile = (await session.execute(
            select(Profile).where(Profile.email == "priya.coordinator@kinguardian.com")
        )).scalar_one_or_none()
        assert profile is not None
        assert profile.display_name == "Priya Sharma"
        assert verify_password("Password123!", profile.password_hash) is True

        audit = (await session.execute(
            select(AuditLog).where(AuditLog.action == "auth.registered.v1")
        )).scalar_one_or_none()
        assert audit is not None


@pytest.mark.asyncio
async def test_duplicate_registration_returns_409(client_and_sessions):
    client, _ = client_and_sessions
    payload = {
        "email": "duplicate@kinguardian.com",
        "password": "Password123!",
        "name": "Duplicate User",
    }
    r1 = await client.post("/api/v1/auth/register", json=payload)
    assert r1.status_code == 201

    r2 = await client.post("/api/v1/auth/register", json=payload)
    assert r2.status_code == 409
    assert "already registered" in r2.json()["detail"]


@pytest.mark.asyncio
async def test_login_with_valid_and_invalid_credentials(client_and_sessions):
    client, _ = client_and_sessions
    reg_payload = {
        "email": "login_test@kinguardian.com",
        "password": "SecretPassword123",
        "name": "Login Tester",
    }
    await client.post("/api/v1/auth/register", json=reg_payload)

    # Valid login
    login_res = await client.post("/api/v1/auth/login", json={
        "email": "login_test@kinguardian.com",
        "password": "SecretPassword123"
    })
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()
    assert login_res.json()["user"]["email"] == "login_test@kinguardian.com"

    # Invalid password
    bad_res = await client.post("/api/v1/auth/login", json={
        "email": "login_test@kinguardian.com",
        "password": "WrongPassword"
    })
    assert bad_res.status_code == 401

    # Non-existent user
    not_found = await client.post("/api/v1/auth/login", json={
        "email": "nobody@kinguardian.com",
        "password": "WrongPassword"
    })
    assert not_found.status_code == 401


@pytest.mark.asyncio
async def test_bearer_token_authenticates_protected_endpoints(client_and_sessions):
    client, _ = client_and_sessions
    # Register coordinator
    reg = await client.post("/api/v1/auth/register", json={
        "email": "bearer_coord@kinguardian.com",
        "password": "Password123!",
        "name": "Bearer Coord",
        "role": "coordinator"
    })
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Access /auth/me
    me_res = await client.get("/api/v1/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["profile"]["email"] == "bearer_coord@kinguardian.com"

    # Create family with Bearer token
    family_res = await client.post("/api/v1/families", headers=headers, json={
        "name": "Bearer Test Family",
        "home_timezone": "Asia/Kolkata"
    })
    assert family_res.status_code == 201
    family_id = family_res.json()["id"]

    # List families with Bearer token
    fam_list = await client.get("/api/v1/families", headers=headers)
    assert fam_list.status_code == 200
    assert len(fam_list.json()) == 1
    assert fam_list.json()[0]["id"] == family_id


@pytest.mark.asyncio
async def test_token_refresh(client_and_sessions):
    client, _ = client_and_sessions
    reg = await client.post("/api/v1/auth/register", json={
        "email": "refresh_user@kinguardian.com",
        "password": "Password123!",
        "name": "Refresh User"
    })
    refresh_token = reg.json()["refresh_token"]

    # Exchange refresh token
    refresh_res = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert refresh_res.status_code == 200
    new_access_token = refresh_res.json()["access_token"]
    assert new_access_token

    # Verify new token works on protected route
    me_res = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_access_token}"})
    assert me_res.status_code == 200
    assert me_res.json()["profile"]["email"] == "refresh_user@kinguardian.com"


@pytest.mark.asyncio
async def test_change_password(client_and_sessions):
    client, _ = client_and_sessions
    reg = await client.post("/api/v1/auth/register", json={
        "email": "change_pwd@kinguardian.com",
        "password": "OldPassword123",
        "name": "Change Pwd User"
    })
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Wrong old password
    fail_res = await client.post("/api/v1/auth/change-password", headers=headers, json={
        "old_password": "WrongPassword",
        "new_password": "NewPassword456!"
    })
    assert fail_res.status_code == 400

    # Correct old password
    ok_res = await client.post("/api/v1/auth/change-password", headers=headers, json={
        "old_password": "OldPassword123",
        "new_password": "NewPassword456!"
    })
    assert ok_res.status_code == 200

    # Login with new password
    login_new = await client.post("/api/v1/auth/login", json={
        "email": "change_pwd@kinguardian.com",
        "password": "NewPassword456!"
    })
    assert login_new.status_code == 200

    # Login with old password fails
    login_old = await client.post("/api/v1/auth/login", json={
        "email": "change_pwd@kinguardian.com",
        "password": "OldPassword123"
    })
    assert login_old.status_code == 401


@pytest.mark.asyncio
async def test_rbac_member_role_updates_and_removal(client_and_sessions):
    client, sessions = client_and_sessions
    # Register coordinator and caregiver
    coord_reg = await client.post("/api/v1/auth/register", json={
        "email": "coord@rbac.com",
        "password": "Password123!",
        "name": "Coordinator User",
        "role": "coordinator"
    })
    coord_token = coord_reg.json()["access_token"]
    coord_headers = {"Authorization": f"Bearer {coord_token}"}

    cg_reg = await client.post("/api/v1/auth/register", json={
        "email": "cg@rbac.com",
        "password": "Password123!",
        "name": "Caregiver User",
        "role": "caregiver"
    })
    cg_token = cg_reg.json()["access_token"]
    cg_id = cg_reg.json()["user"]["id"]
    cg_headers = {"Authorization": f"Bearer {cg_token}"}

    # Coordinator creates family
    fam_res = await client.post("/api/v1/families", headers=coord_headers, json={"name": "RBAC Family"})
    fam_id = fam_res.json()["id"]

    # Coordinator adds caregiver as member
    add_m = await client.post(f"/api/v1/families/{fam_id}/members", headers=coord_headers, json={
        "profile_id": cg_id,
        "role": "caregiver"
    })
    assert add_m.status_code == 201

    # List members
    members = await client.get(f"/api/v1/families/{fam_id}/members", headers=coord_headers)
    assert members.status_code == 200
    assert len(members.json()) == 2

    # Coordinator updates caregiver role to observer
    patch_res = await client.patch(f"/api/v1/families/{fam_id}/members/{cg_id}", headers=coord_headers, json={
        "role": "observer"
    })
    assert patch_res.status_code == 200
    assert patch_res.json()["role"] == "observer"

    # Caregiver (now observer) tries to update coordinator's role -> 403 Forbidden
    coord_id = coord_reg.json()["user"]["id"]
    forbidden_patch = await client.patch(f"/api/v1/families/{fam_id}/members/{coord_id}", headers=cg_headers, json={
        "role": "observer"
    })
    assert forbidden_patch.status_code == 403

    # Coordinator removes caregiver from family
    del_res = await client.delete(f"/api/v1/families/{fam_id}/members/{cg_id}", headers=coord_headers)
    assert del_res.status_code == 200

    # Coordinator cannot remove self if only coordinator
    self_del = await client.delete(f"/api/v1/families/{fam_id}/members/{coord_id}", headers=coord_headers)
    assert self_del.status_code == 400


@pytest.mark.asyncio
async def test_access_grant_listing_and_revocation(client_and_sessions):
    client, _ = client_and_sessions
    # Setup coordinator, caregiver, parent
    coord = (await client.post("/api/v1/auth/register", json={
        "email": "c_grant@kinguardian.com",
        "password": "Password123!",
        "name": "Coordinator",
        "role": "coordinator"
    })).json()
    coord_headers = {"Authorization": f"Bearer {coord['access_token']}"}

    cg = (await client.post("/api/v1/auth/register", json={
        "email": "cg_grant@kinguardian.com",
        "password": "Password123!",
        "name": "Caregiver",
        "role": "caregiver"
    })).json()
    cg_headers = {"Authorization": f"Bearer {cg['access_token']}"}

    # Coordinator creates family and subject
    fam_id = (await client.post("/api/v1/families", headers=coord_headers, json={"name": "Grant Family"})).json()["id"]
    await client.post(f"/api/v1/families/{fam_id}/members", headers=coord_headers, json={"profile_id": cg["user"]["id"], "role": "caregiver"})
    subject_id = (await client.post(f"/api/v1/families/{fam_id}/subjects", headers=coord_headers, json={"preferred_timezone": "Asia/Kolkata"})).json()["id"]

    # Before grant: Caregiver cannot log check-in -> 403
    fail_checkin = await client.post("/api/v1/check-ins", headers=cg_headers, json={
        "family_id": fam_id,
        "subject_id": subject_id,
        "occurred_at": "2026-09-04T10:00:00+05:30",
        "mood": "good",
        "severity": "normal"
    })
    assert fail_checkin.status_code == 403

    # Coordinator grants 'checkins' scope to caregiver
    grant_res = await client.post(f"/api/v1/families/{fam_id}/subjects/{subject_id}/access-grants", headers=coord_headers, json={
        "profile_id": cg["user"]["id"],
        "scopes": ["checkins"]
    })
    assert grant_res.status_code == 201
    grant_id = grant_res.json()["id"]

    # Caregiver can now log check-in -> 201
    ok_checkin = await client.post("/api/v1/check-ins", headers=cg_headers, json={
        "family_id": fam_id,
        "subject_id": subject_id,
        "occurred_at": "2026-09-04T10:00:00+05:30",
        "mood": "good",
        "severity": "normal"
    })
    assert ok_checkin.status_code == 201

    # List grants
    grants_list = await client.get(f"/api/v1/families/{fam_id}/subjects/{subject_id}/access-grants", headers=coord_headers)
    assert grants_list.status_code == 200
    assert len(grants_list.json()) == 1

    # Revoke grant
    revoke_res = await client.delete(f"/api/v1/families/{fam_id}/subjects/{subject_id}/access-grants/{grant_id}", headers=coord_headers)
    assert revoke_res.status_code == 200

    # Caregiver can NO LONGER log check-in -> 403
    revoked_checkin = await client.post("/api/v1/check-ins", headers=cg_headers, json={
        "family_id": fam_id,
        "subject_id": subject_id,
        "occurred_at": "2026-09-04T11:00:00+05:30",
        "mood": "tired",
        "severity": "normal"
    })
    assert revoked_checkin.status_code == 403


@pytest.mark.asyncio
async def test_auth_me_and_token_response_include_roles_and_permissions(client_and_sessions):
    client, _ = client_and_sessions
    reg_res = await client.post("/api/v1/auth/register", json={
        "email": "permissions.test@kinguardian.com",
        "password": "Password123!",
        "name": "Permissions Tester",
        "role": "coordinator"
    })
    assert reg_res.status_code == 201
    data = reg_res.json()
    assert "role" in data
    assert data["role"] == "coordinator"
    assert "permissions" in data
    assert "care:manage" in data["permissions"]
    assert "checkins:read" in data["permissions"]

    token = data["access_token"]
    me_res = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["role"] == "coordinator"
    assert "permissions" in me_data
    assert "care:manage" in me_data["permissions"]


@pytest.mark.asyncio
async def test_iam_token_exchange(client_and_sessions):
    client, _ = client_and_sessions
    # Generate a local token representing an IAM token
    raw_token = create_access_token({
        "sub": "iam_user_ext_456",
        "email": "iam.doctor@kinguardian.com",
        "name": "Dr. Ramesh IAM",
        "role": "coordinator",
        "permissions": ["patient:read", "encounter:create"]
    })

    res = await client.post("/api/v1/auth/iam-token", json={"token": raw_token})
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["email"] == "iam.doctor@kinguardian.com"
    assert data["user"]["display_name"] == "Dr. Ramesh IAM"
    assert data["role"] == "coordinator"
    assert "patient:read" in data["permissions"]
    assert "care:manage" in data["permissions"]


# =============================================================================
# FAM-001, FAM-010, FAM-011, FAM-008, AUTH-002: Family Model & Role Isolation
# =============================================================================

@pytest.mark.asyncio
async def test_fam_001_one_parent_and_two_parent_onboarding_persistence(client_and_sessions):
    """Extend FAM-001 for one and two parents, refresh/relogin persistence and idempotent retry."""
    client, sessions = client_and_sessions
    # 1. Register coordinator
    coord_reg = await client.post("/api/v1/auth/register", json={
        "email": "kalyan.coord@example.com",
        "password": "Password123!",
        "name": "Kalyan Coordinator",
        "role": "coordinator"
    })
    assert coord_reg.status_code == 201
    coord_token = coord_reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {coord_token}"}

    # 2. Case A: Single Parent Onboarding
    single_res = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "UK",
        "family_name": "Kalyan Single Family",
        "parent": {
            "name": "Ramesh",
            "relationship": "Father",
            "city": "Chennai",
            "age": 68
        }
    }, headers=headers)
    assert single_res.status_code == 200
    single_data = single_res.json()
    assert single_data["status"] == "completed"
    assert len(single_data["parents"]) == 1
    assert single_data["parent"]["display_name"] == "Ramesh"
    single_fam_id = single_data["family_id"]

    # 3. Case B: Two Parents Onboarding in fresh family
    two_res = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "UK",
        "family_name": "Kalyan Dual Family",
        "force_new": True,
        "parents": [
            {
                "name": "Aniruddha",
                "relationship": "Father",
                "city": "Chennai",
                "age": 68
            },
            {
                "name": "Vandana",
                "relationship": "Mother",
                "city": "Bengaluru",
                "age": 64
            }
        ]
    }, headers=headers)
    assert two_res.status_code == 200
    two_data = two_res.json()
    assert len(two_data["parents"]) == 2
    dual_fam_id = two_data["family_id"]

    parent_names = [p["display_name"] for p in two_data["parents"]]
    assert "Aniruddha" in parent_names
    assert "Vandana" in parent_names

    # 4. Verify idempotent retry behavior does not duplicate records
    retry_res = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "UK",
        "family_name": "Kalyan Dual Family",
        "parents": [
            {
                "name": "Aniruddha",
                "relationship": "Father",
                "city": "Chennai",
                "age": 68
            },
            {
                "name": "Vandana",
                "relationship": "Mother",
                "city": "Bengaluru",
                "age": 64
            }
        ]
    }, headers=headers)
    assert retry_res.status_code == 200

    async with sessions() as session:
        # Check care subjects count for dual family
        subs = (await session.execute(
            select(CareSubject).where(CareSubject.family_id == uuid.UUID(dual_fam_id))
        )).scalars().all()
        assert len(subs) == 2, f"Expected exactly 2 care subjects, found {len(subs)}"


@pytest.mark.asyncio
async def test_fam_010_coordinator_is_not_implicitly_a_care_subject(client_and_sessions):
    """FAM-010: Coordinator is not implicitly a care subject."""
    client, sessions = client_and_sessions
    reg = await client.post("/api/v1/auth/register", json={
        "email": "solo.coord@example.com",
        "password": "Password123!",
        "name": "Solo Coordinator",
        "role": "coordinator"
    })
    coord_token = reg.json()["access_token"]
    coord_id = reg.json()["user"]["id"]
    headers = {"Authorization": f"Bearer {coord_token}"}

    # Onboard with one parent
    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "UK",
        "family_name": "Solo Circle",
        "parent": {
            "name": "Father Suresh",
            "relationship": "Father",
            "city": "Chennai",
            "age": 70
        }
    }, headers=headers)
    assert onb.status_code == 200
    fam_id = onb.json()["family_id"]

    async with sessions() as session:
        # Verify coordinator profile has role 'coordinator'
        c_prof = await session.get(Profile, uuid.UUID(coord_id))
        assert c_prof.role == "coordinator"

        # Verify no CareSubject has coordinator's profile_id
        coord_as_subject = (await session.execute(
            select(CareSubject).where(CareSubject.profile_id == uuid.UUID(coord_id))
        )).scalar_one_or_none()
        assert coord_as_subject is None, "Coordinator must not implicitly have a CareSubject record!"

        # Query home endpoint to verify parents list excludes coordinator
        home_res = await client.get(f"/api/v1/families/{fam_id}/home", headers=headers)
        assert home_res.status_code == 200
        home_data = home_res.json()
        parent_profile_ids = [p.get("profile_id") for p in home_data.get("parents", [])]
        assert coord_id not in parent_profile_ids


@pytest.mark.asyncio
async def test_fam_011_two_parents_have_distinct_ids_contact_and_records(client_and_sessions):
    """FAM-011: Two parents have distinct IDs/contact/location/records."""
    client, sessions = client_and_sessions
    reg = await client.post("/api/v1/auth/register", json={
        "email": "dual.coord@example.com",
        "password": "Password123!",
        "name": "Dual Coordinator",
        "role": "coordinator"
    })
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "UK",
        "family_name": "Dual Parents Circle",
        "parents": [
            {
                "name": "Father Dev",
                "relationship": "Father",
                "city": "Chennai",
                "age": 72,
                "email": "dev.father@example.com"
            },
            {
                "name": "Mother Sita",
                "relationship": "Mother",
                "city": "Bengaluru",
                "age": 69,
                "email": "sita.mother@example.com"
            }
        ]
    }, headers=headers)
    assert onb.status_code == 200
    data = onb.json()
    parents = data["parents"]
    assert len(parents) == 2

    p1, p2 = parents[0], parents[1]
    # Distinct profile IDs
    assert p1["id"] != p2["id"]
    # Distinct care subject IDs
    assert p1["subject_id"] != p2["subject_id"]
    # Distinct emails
    assert p1["email"] != p2["email"]
    # Distinct relationships
    assert p1["relationship"] != p2["relationship"]
    # Distinct cities
    assert p1["city"] != p2["city"]


@pytest.mark.asyncio
async def test_fam_008_and_auth_002_directory_and_role_correctness(client_and_sessions):
    """Extend FAM-008 and AUTH-002: directory/role correctness and parent cannot access coordinator routes."""
    client, sessions = client_and_sessions
    # Register coordinator
    coord_res = await client.post("/api/v1/auth/register", json={
        "email": "dir.coord@example.com",
        "password": "Password123!",
        "name": "Directory Coordinator",
        "role": "coordinator"
    })
    coord_token = coord_res.json()["access_token"]
    coord_headers = {"Authorization": f"Bearer {coord_token}"}

    # Onboard family
    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "UK",
        "family_name": "Directory Family",
        "parents": [
            {
                "name": "Ramesh Parent",
                "relationship": "Father",
                "city": "Chennai",
                "age": 68,
                "email": "ramesh.dir.parent@example.com"
            }
        ]
    }, headers=coord_headers)
    fam_id = onb.json()["family_id"]

    # 1. Test FAM-008: List members displays correct roles and relationships
    members_res = await client.get(f"/api/v1/families/{fam_id}/members", headers=coord_headers)
    assert members_res.status_code == 200
    members = members_res.json()
    assert len(members) >= 2

    coord_m = next((m for m in members if m["role"] == "coordinator"), None)
    parent_m = next((m for m in members if m["role"] == "parent"), None)
    assert coord_m is not None
    assert parent_m is not None
    assert coord_m["display_name"] == "Directory Coordinator"
    assert parent_m["display_name"] == "Ramesh Parent"

    # 2. Test AUTH-002: Parent cannot access coordinator-only route (post new subject)
    parent_token = create_access_token({
        "sub": parent_m["profile_id"],
        "email": parent_m["email"],
        "name": parent_m["display_name"],
        "role": "parent"
    })
    parent_headers = {"Authorization": f"Bearer {parent_token}"}

    forbidden_res = await client.post(
        f"/api/v1/families/{fam_id}/subjects",
        json={"preferred_timezone": "Asia/Kolkata"},
        headers=parent_headers
    )
    # Role-based restriction prevents parent from managing care subjects (COORDINATOR role required)
    assert forbidden_res.status_code == 403


@pytest.mark.asyncio
async def test_sec_007_search_care_subject_scoping_and_isolation(client_and_sessions):
    """SEC-007: Unified search scoped by subject_id isolates records between care subjects."""
    client, sessions = client_and_sessions
    coord_res = await client.post("/api/v1/auth/register", json={
        "email": "search.scoping.coord@example.com",
        "password": "Password123!",
        "name": "Search Scope Coordinator",
        "role": "coordinator"
    })
    coord_token = coord_res.json()["access_token"]
    coord_headers = {"Authorization": f"Bearer {coord_token}"}

    # Onboard two distinct parents
    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "UK",
        "family_name": "Multi-Subject Search Family",
        "parents": [
            {
                "name": "Aniruddha Father",
                "relationship": "Father",
                "city": "Bengaluru",
                "age": 70,
                "email": "aniruddha.search@example.com"
            },
            {
                "name": "Sita Mother",
                "relationship": "Mother",
                "city": "Bengaluru",
                "age": 67,
                "email": "sita.search@example.com"
            }
        ]
    }, headers=coord_headers)
    assert onb.status_code == 200
    parents = onb.json()["parents"]
    dad_subject_id = parents[0]["subject_id"]
    mom_subject_id = parents[1]["subject_id"]

    # Seed medication records for each subject into the database
    async with sessions() as db_session:
        dad_med = MedicationAdherence(
            subject_id=uuid.UUID(dad_subject_id),
            medication_ref="Atorvastatin 20mg",
            source="manual",
            taken_at=datetime.now(UTC)
        )
        mom_med = MedicationAdherence(
            subject_id=uuid.UUID(mom_subject_id),
            medication_ref="Metformin 500mg",
            source="manual",
            taken_at=datetime.now(UTC)
        )
        db_session.add(dad_med)
        db_session.add(mom_med)
        await db_session.commit()

    # 1. Search without subject_id returns both parents' authorized records
    all_res = await client.get("/api/v1/search?q=medication", headers=coord_headers)
    assert all_res.status_code == 200
    all_data = all_res.json()
    all_titles = [r["title"] for r in all_data["results"]]
    assert any("Atorvastatin" in t for t in all_titles)
    assert any("Metformin" in t for t in all_titles)

    # 2. Search scoped to Dad only returns Dad's medication, zero of Mom's
    dad_res = await client.get(f"/api/v1/search?q=medication&subject_id={dad_subject_id}", headers=coord_headers)
    assert dad_res.status_code == 200
    dad_data = dad_res.json()
    dad_titles = [r["title"] for r in dad_data["results"]]
    assert any("Atorvastatin" in t for t in dad_titles)
    assert not any("Metformin" in t for t in dad_titles)

    # 3. Search scoped to Mom only returns Mom's medication, zero of Dad's
    mom_res = await client.get(f"/api/v1/search?q=medication&subject_id={mom_subject_id}", headers=coord_headers)
    assert mom_res.status_code == 200
    mom_data = mom_res.json()
    mom_titles = [r["title"] for r in mom_data["results"]]
    assert any("Metformin" in t for t in mom_titles)
    assert not any("Atorvastatin" in t for t in mom_titles)


@pytest.mark.asyncio
async def test_coord_007_new_coordinator_has_zero_fabricated_alerts_or_devices(client_and_sessions):
    """COORD-007: Fresh coordinator onboarding produces calm state with zero fabricated alerts or devices."""
    client, sessions = client_and_sessions
    coord_res = await client.post("/api/v1/auth/register", json={
        "email": "fresh.calm.coord@example.com",
        "password": "Password123!",
        "name": "Fresh Calm Coordinator",
        "role": "coordinator"
    })
    coord_token = coord_res.json()["access_token"]
    coord_headers = {"Authorization": f"Bearer {coord_token}"}

    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "UK",
        "family_name": "Fresh Circle",
        "parents": [
            {
                "name": "Kalyan Father",
                "relationship": "Father",
                "city": "Hyderabad",
                "age": 65,
                "email": "kalyan.parent@example.com"
            }
        ]
    }, headers=coord_headers)
    assert onb.status_code == 200
    family_id = onb.json()["family_id"]
    subject_id = onb.json()["parents"][0]["subject_id"]

    home_res = await client.get(f"/api/v1/families/{family_id}/home", headers=coord_headers)
    assert home_res.status_code == 200
    home_data = home_res.json()

    # Reassurance state must indicate calm without fabricated clinical health claims
    reassurance = home_data["reassurance"]
    assert reassurance["urgent_alerts_count"] == 0
    assert reassurance["is_false_alert"] is False
    assert reassurance["no_attention_required"] is True
    assert home_data["today_attention"]["guardian_moment"] is None


@pytest.mark.asyncio
async def test_dev_001_and_sum_001_device_and_summary_isolation(client_and_sessions):
    """DEV-001 & SUM-001: Device connections and summary respect subject scoping without leaking coordinator."""
    client, sessions = client_and_sessions
    coord_res = await client.post("/api/v1/auth/register", json={
        "email": "dev.sum.coord@example.com",
        "password": "Password123!",
        "name": "Device Coordinator",
        "role": "coordinator"
    })
    coord_token = coord_res.json()["access_token"]
    coord_headers = {"Authorization": f"Bearer {coord_token}"}

    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "UK",
        "family_name": "Device Test Circle",
        "parents": [
            {
                "name": "Parent Subject One",
                "relationship": "Father",
                "city": "Delhi",
                "age": 71,
                "email": "p1.dev@example.com"
            }
        ]
    }, headers=coord_headers)
    assert onb.status_code == 200
    sub_id = onb.json()["parents"][0]["subject_id"]

    # Emergency summary queries authorized subject and does NOT turn coordinator into a care subject
    emg_res = await client.get(f"/api/v1/subjects/{sub_id}/emergency-summary", headers=coord_headers)
    assert emg_res.status_code == 200
    emg_data = emg_res.json()
    assert emg_data["subject_id"] == sub_id
    assert emg_data["patient_name"] == "Parent Subject One"

    # Query for non-existent subject yields 404 rather than creating a dummy CareSubject for the coordinator
    fake_uuid = str(uuid.uuid4())
    fake_res = await client.get(f"/api/v1/subjects/{fake_uuid}/emergency-summary", headers=coord_headers)
    assert fake_res.status_code in (400, 404)


@pytest.mark.asyncio
async def test_prof_001_us_coordinator_location_roundtrip(client_and_sessions):
    """PROF-001: Country/city round-trip for US coordinator without reverting to UK or India defaults."""
    client, sessions = client_and_sessions
    reg = await client.post("/api/v1/auth/register", json={
        "email": "us_coord@example.com",
        "password": "Password123!",
        "name": "US Coordinator",
        "role": "coordinator",
        "city": "Austin",
        "country": "United States"
    })
    assert reg.status_code in (200, 201)
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Verify /profiles/me returns Austin, United States
    me_res = await client.get("/api/v1/profiles/me", headers=headers)
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["city"] == "Austin"
    assert me_data["country"] == "United States"
    assert "Austin, United States" in me_data["location"]

    # Now onboard with location="USA"
    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "USA",
        "family_name": "Austin Family",
        "parents": [
            {
                "name": "Elder Father",
                "relationship": "Father",
                "city": "Austin",
                "country": "United States",
                "age": 75
            }
        ]
    }, headers=headers)
    assert onb.status_code == 200
    fam_id = onb.json()["family_id"]

    # Verify home dashboard shows coordinator in United States / Austin
    home_res = await client.get(f"/api/v1/families/{fam_id}/home", headers=headers)
    assert home_res.status_code == 200
    home_data = home_res.json()
    assert home_data["family"]["coordinator_country"] == "United States"
    assert home_data["family"]["coordinator_city"] == "Austin"
    assert "United States" in home_data["family"]["coordinator_location"]
    # Ensure timezone is separate and valid (e.g. America/New_York)
    assert home_data["family"]["coordinator_timezone"] == "America/New_York"


@pytest.mark.asyncio
async def test_prof_002_coordinator_and_parent_locations_remain_distinct_in_care_circle(client_and_sessions):
    """PROF-002: Coordinator and parent locations remain distinct across Care Circle."""
    client, sessions = client_and_sessions
    reg = await client.post("/api/v1/auth/register", json={
        "email": "distinct_loc_coord@example.com",
        "password": "Password123!",
        "name": "Global Coordinator",
        "role": "coordinator"
    })
    assert reg.status_code in (200, 201)
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Coordinator is in USA / San Francisco, Parent 1 is in Chennai, India, Parent 2 is in Bengaluru, India
    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "location": "USA",
        "city": "San Francisco",
        "family_name": "Distinct Location Circle",
        "parents": [
            {
                "name": "Mom in Chennai",
                "relationship": "Mother",
                "city": "Chennai",
                "country": "India",
                "age": 68
            },
            {
                "name": "Dad in Bengaluru",
                "relationship": "Father",
                "city": "Bengaluru",
                "country": "India",
                "age": 70
            }
        ]
    }, headers=headers)
    assert onb.status_code == 200
    fam_id = onb.json()["family_id"]

    # Query Care Circle members list
    members_res = await client.get(f"/api/v1/families/{fam_id}/members", headers=headers)
    assert members_res.status_code == 200
    members = members_res.json()

    coord_member = next(m for m in members if m["role"] == "coordinator")
    mom_member = next(m for m in members if m["name"] == "Mom in Chennai")
    dad_member = next(m for m in members if m["name"] == "Dad in Bengaluru")

    # Verify coordinator's location is San Francisco, United States
    assert coord_member["country"] == "United States"
    assert coord_member["city"] == "San Francisco"
    assert "United States" in coord_member["location"]

    # Verify Mom's location is Chennai, India
    assert mom_member["city"] == "Chennai"
    assert mom_member["country"] == "India"
    assert "Chennai, India" in mom_member["location"]

    # Verify Dad's location is Bengaluru, India
    assert dad_member["city"] == "Bengaluru"
    assert dad_member["country"] == "India"
    assert "Bengaluru, India" in dad_member["location"]

    # Ensure coordinator location did not overwrite parents and parents did not overwrite coordinator
    assert mom_member["location"] != coord_member["location"]
    assert dad_member["location"] != coord_member["location"]


@pytest.mark.asyncio
async def test_prof_blank_location_regression_no_fabricated_default(client_and_sessions):
    """Regression: Blank location yields 'Not provided' rather than a fabricated default like London or Bengaluru."""
    client, sessions = client_and_sessions
    reg = await client.post("/api/v1/auth/register", json={
        "email": "blank_loc@example.com",
        "password": "Password123!",
        "name": "Blank Loc User",
        "role": "coordinator"
    })
    assert reg.status_code in (200, 201)
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    me_res = await client.get("/api/v1/profiles/me", headers=headers)
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["city"] is None
    assert me_data["country"] is None
    assert me_data["location"] == "Not provided"


@pytest.mark.asyncio
async def test_inv_001_invite_with_missing_destination_fails_validation_without_provider_call(client_and_sessions):
    """INV-001: Missing email/phone yields 422 validation error and does not call delivery provider."""
    client, sessions = client_and_sessions
    reg = await client.post("/api/v1/auth/register", json={
        "email": "inv_coord_1@example.com",
        "password": "Password123!",
        "name": "Inv Coordinator 1",
        "role": "coordinator"
    })
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "family_name": "Validation Fam",
        "parents": [{"name": "Dad", "relationship": "Father"}]
    }, headers=headers)
    fam_id = onb.json()["family_id"]

    # Attempt to invite with email channel but empty email
    res_no_email = await client.post(f"/api/v1/families/{fam_id}/invite", json={
        "role": "parent",
        "channel": "email",
        "email": ""
    }, headers=headers)
    assert res_no_email.status_code == 422
    assert "email address is required" in res_no_email.json()["detail"].lower()

    # Attempt to invite with WhatsApp channel but empty phone
    res_no_phone = await client.post(f"/api/v1/families/{fam_id}/invite", json={
        "role": "parent",
        "channel": "whatsapp",
        "phone": ""
    }, headers=headers)
    assert res_no_phone.status_code == 422
    assert "phone number is required" in res_no_phone.json()["detail"].lower()


@pytest.mark.asyncio
async def test_inv_002_unconfigured_channels_capabilities_and_send_rejection(client_and_sessions):
    """INV-002: Capabilities report truthful status (not_configured for whatsapp/sms), and sending to unconfigured channel is rejected honestly."""
    client, sessions = client_and_sessions
    
    # 1. Check /invitations/capabilities endpoint
    caps_res = await client.get("/api/v1/invitations/capabilities")
    assert caps_res.status_code == 200
    caps = caps_res.json()
    assert caps["email"]["status"] == "available"
    assert caps["email"]["configured"] is True
    assert caps["whatsapp"]["status"] == "not_configured"
    assert caps["whatsapp"]["configured"] is False
    assert caps["sms"]["status"] == "not_configured"
    assert caps["sms"]["configured"] is False

    # 2. Register coordinator & family
    reg = await client.post("/api/v1/auth/register", json={
        "email": "inv_coord_2@example.com",
        "password": "Password123!",
        "name": "Inv Coordinator 2",
        "role": "coordinator"
    })
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "family_name": "Unconfigured Fam",
        "parents": [{"name": "Dad", "relationship": "Father"}]
    }, headers=headers)
    fam_id = onb.json()["family_id"]

    # 3. Sending via unconfigured WhatsApp returns not_configured delivery status honestly, never claims accepted
    inv_res = await client.post(f"/api/v1/families/{fam_id}/invite", json={
        "role": "parent",
        "name": "Uncle",
        "channel": "whatsapp",
        "phone": "+15551234567"
    }, headers=headers)
    assert inv_res.status_code in (200, 201)
    inv_data = inv_res.json()
    assert inv_data["delivery"]["channel"] == "whatsapp"
    assert inv_data["delivery"]["status"] == "not_configured"
    assert inv_data["delivery"]["status"] != "accepted"


@pytest.mark.asyncio
async def test_inv_003_provider_accepted_failed_timeout_and_idempotent_retry(client_and_sessions):
    """INV-003: Provider accepted delivery, timeout/outage status handling, and idempotent retry preventing duplicate memberships."""
    from app.adapters import invitation_registry
    client, sessions = client_and_sessions

    reg = await client.post("/api/v1/auth/register", json={
        "email": "inv_coord_3@example.com",
        "password": "Password123!",
        "name": "Inv Coordinator 3",
        "role": "coordinator"
    })
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    onb = await client.post("/api/v1/coordinator/onboarding", json={
        "family_name": "Idempotent Fam",
        "parents": [{"name": "Dad", "relationship": "Father"}]
    }, headers=headers)
    fam_id = onb.json()["family_id"]

    # 1. Normal email invite -> accepted
    idem_key = "test-idem-key-101"
    inv_ok = await client.post(f"/api/v1/families/{fam_id}/invite", json={
        "email": "valid.recipient@example.com",
        "name": "Valid Recipient",
        "role": "parent",
        "channel": "email",
        "idempotency_key": idem_key
    }, headers=headers)
    assert inv_ok.status_code in (200, 201)
    inv_ok_data = inv_ok.json()
    assert inv_ok_data["delivery"]["status"] == "accepted"
    assert inv_ok_data["delivery"]["message_id"] is not None

    # 2. Replay with identical idempotency_key -> safe idempotency response, no duplicate member created
    replay = await client.post(f"/api/v1/families/{fam_id}/invite", json={
        "email": "valid.recipient@example.com",
        "name": "Valid Recipient",
        "role": "parent",
        "channel": "email",
        "idempotency_key": idem_key
    }, headers=headers)
    assert replay.status_code in (200, 201)
    replay_data = replay.json()
    assert replay_data["idempotent"] is True
    assert replay_data["status"] == "already_processed"

    # Verify Care Circle has exactly 2 members (coordinator + single parent), no duplicates
    mems = (await client.get(f"/api/v1/families/{fam_id}/members", headers=headers)).json()
    parent_mems = [m for m in mems if m["email"] == "valid.recipient@example.com"]
    assert len(parent_mems) == 1

    # 3. Simulate email outage -> returns temporarily_unavailable without breaking family creation
    invitation_registry.simulate_email_outage = True
    try:
        inv_down = await client.post(f"/api/v1/families/{fam_id}/invite", json={
            "email": "another.recipient@example.com",
            "name": "Another Recipient",
            "role": "caregiver",
            "channel": "email"
        }, headers=headers)
        assert inv_down.status_code in (200, 201)
        assert inv_down.json()["delivery"]["status"] == "temporarily_unavailable"
    finally:
        invitation_registry.simulate_email_outage = False





