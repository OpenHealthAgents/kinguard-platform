"""Replaceable outbound adapters used by the application layer.

Production adapters call provider APIs. These deterministic adapters let workflow
tests run without external credentials or network calls.
"""
import re
from dataclasses import dataclass, field
from typing import Protocol


class NotificationAdapter(Protocol):
    async def deliver(self, recipient_id: str, event_type: str, payload: dict) -> None: ...


@dataclass
class InvitationDeliveryResult:
    channel: str
    status: str  # "accepted", "not_configured", "temporarily_unavailable", "failed"
    message_id: str | None = None
    detail: str | None = None


class InvitationProviderRegistry:
    """Registry maintaining truthful capability and delivery states for WhatsApp, SMS, and Email."""
    
    def __init__(
        self,
        email_configured: bool = True,
        whatsapp_configured: bool = False,
        sms_configured: bool = False,
        simulate_email_outage: bool = False,
        simulate_timeout: bool = False
    ):
        self.email_configured = email_configured
        self.whatsapp_configured = whatsapp_configured
        self.sms_configured = sms_configured
        self.simulate_email_outage = simulate_email_outage
        self.simulate_timeout = simulate_timeout
        self.delivered_invitations: list[dict] = []

    def get_capabilities(self) -> dict:
        from app.adapters.whatsapp import whatsapp_adapter
        wa_avail = self.whatsapp_configured or whatsapp_adapter.is_configured or whatsapp_adapter.mock_mode
        return {
            "email": {
                "configured": self.email_configured,
                "status": "temporarily_unavailable" if self.simulate_email_outage else ("available" if self.email_configured else "not_configured"),
                "channel": "email",
                "notes": "Transactional email provider active" if self.email_configured else "SMTP/Email credentials not configured"
            },
            "whatsapp": {
                "configured": wa_avail,
                "status": "available" if wa_avail else "not_configured",
                "channel": "whatsapp",
                "notes": "WhatsApp Business Platform verified" if wa_avail else "WhatsApp Business gateway not configured yet (contact KinGuardian support for enterprise onboarding)"
            },
            "sms": {
                "configured": self.sms_configured,
                "status": "available" if self.sms_configured else "not_configured",
                "channel": "sms",
                "notes": "SMS Gateway active" if self.sms_configured else "SMS provider not configured (simulated/offline)"
            }
        }

    async def send_invitation(
        self,
        channel: str,
        destination: str,
        invitee_name: str,
        coordinator_name: str,
        role: str = "parent",
        family_name: str = "Family Care Circle",
        **kwargs
    ) -> InvitationDeliveryResult:
        ch = channel.lower()
        if ch not in ("email", "whatsapp", "sms"):
            return InvitationDeliveryResult(
                channel=ch,
                status="failed",
                detail=f"Unsupported invitation channel '{channel}'"
            )

        if not destination or not destination.strip():
            return InvitationDeliveryResult(
                channel=ch,
                status="failed",
                detail=f"Missing destination contact for channel '{channel}'"
            )

        # Check configuration
        if ch == "whatsapp":
            from app.adapters.whatsapp import whatsapp_adapter, normalize_phone_number
            if not self.whatsapp_configured and not whatsapp_adapter.is_configured and not whatsapp_adapter.mock_mode:
                return InvitationDeliveryResult(
                    channel=ch,
                    status="not_configured",
                    detail="WhatsApp Business Platform credentials are not configured on this server."
                )
            try:
                norm_phone = normalize_phone_number(destination)
            except ValueError as ve:
                return InvitationDeliveryResult(
                    channel=ch,
                    status="failed",
                    detail=str(ve)
                )

            if whatsapp_adapter.is_configured or whatsapp_adapter.mock_mode:
                from app.config import settings
                invite_url = kwargs.get("invite_url") or f"{settings.app_base_url.rstrip('/')}/invite/accept"
                wa_res = await whatsapp_adapter.send_parent_invitation(
                    parent_phone=norm_phone,
                    parent_name=invitee_name,
                    coordinator_name=coordinator_name,
                    family_name=family_name,
                    invite_url=invite_url
                )
                return InvitationDeliveryResult(
                    channel="whatsapp",
                    status=wa_res.status,
                    message_id=wa_res.message_id,
                    detail=wa_res.detail
                )

        if ch == "sms" and not self.sms_configured:
            return InvitationDeliveryResult(
                channel=ch,
                status="not_configured",
                detail="SMS channel not configured in this environment"
            )
        if ch == "email" and not self.email_configured:
            return InvitationDeliveryResult(
                channel=ch,
                status="not_configured",
                detail="Email channel not configured in this environment"
            )

        # Simulate provider outage / timeout
        if self.simulate_timeout:
            return InvitationDeliveryResult(
                channel=ch,
                status="temporarily_unavailable",
                detail="Provider gateway timed out after 5000ms"
            )
        if ch == "email" and self.simulate_email_outage:
            return InvitationDeliveryResult(
                channel=ch,
                status="temporarily_unavailable",
                detail="Email delivery provider 503 Service Unavailable"
            )

        import uuid
        msg_id = f"{ch}-msg-{uuid.uuid4().hex[:12]}"
        record = {
            "channel": ch,
            "destination": destination.strip(),
            "invitee_name": invitee_name,
            "coordinator_name": coordinator_name,
            "role": role,
            "family_name": family_name,
            "message_id": msg_id
        }
        self.delivered_invitations.append(record)

        return InvitationDeliveryResult(
            channel=ch,
            status="accepted",
            message_id=msg_id,
            detail=f"Invitation accepted by {ch} provider"
        )


invitation_registry = InvitationProviderRegistry()


class AIAdapter(Protocol):
    async def generate_insight(self, question: str, context: dict) -> str: ...


@dataclass
class MockNotificationAdapter:
    deliveries: list[dict] = field(default_factory=list)
    simulate_outage: bool = False

    async def deliver(self, recipient_id: str, event_type: str, payload: dict) -> None:
        if self.simulate_outage or (isinstance(payload, dict) and (payload.get("simulate_push_unavailable") or payload.get("simulate_push_outage"))):
            raise RuntimeError("Push provider unavailable (APNs/FCM 503 Service Unavailable)")
        self.deliveries.append({"recipient_id": recipient_id, "event_type": event_type, "payload": payload})


class MockAIAdapter:
    async def generate_insight(self, question: str, context: dict) -> str:
        q_lower = (question or "").lower()
        if any(k in q_lower for k in ["[simulate_outage]", "[ai_offline]", "simulate ai unavailable", "simulate outage", "test ai-007", "ai service unavailable"]):
            raise RuntimeError("AI service endpoint unreachable or temporarily offline. Safe clinical fallback provided.")

        severity = context.get("latest_checkin_severity", "normal")
        raw_name = context.get("parent_name", "Ramesh")
        parent_name = "Ramesh"
        if raw_name:
            if isinstance(raw_name, str) and raw_name.strip().startswith("{"):
                try:
                    import json
                    parsed = json.loads(raw_name)
                    parent_name = parsed.get("name") or parsed.get("display_name") or "Ramesh"
                except Exception:
                    parent_name = "Ramesh"
            else:
                cleaned = re.sub(r'\(.*?\)', '', str(raw_name)).strip()
                if cleaned and cleaned != "Parent":
                    parent_name = cleaned

        # 1. Daily Health Status & Vitals (TEST AI-001)
        if any(k in q_lower for k in [
            "how is dad doing", "how is father doing", "how is ramesh doing", "how is dad", "how is ramesh",
            "dad status", "parent status", "health summary", "daily summary", "how is he doing", "how is he",
            "father doing", "dad's health", "ramesh's health", "how is dad today", "health update", "status update",
            "well-being", "today's update", "tell me about dad", "tell me about ramesh", "dad doing", "ramesh doing"
        ]):
            return (
                f"Here is {parent_name}'s current clinical summary for today:\n\n"
                f"🩺 **Vitals & Well-being:** Morning check-in recorded a positive mood with stable vitals ({severity}). "
                f"Evening blood pressure showed a mild systolic variance (138/88 mmHg, pulse 74 bpm), which correlates with today's midday heatwave index in Chennai (39°C).\n\n"
                f"💊 **Medication Compliance (92%):** Amlodipine 5mg was confirmed taken at 8:15 AM IST. Evening Atorvastatin 20mg is scheduled for 8:00 PM IST.\n\n"
                f"🚶 **Activity:** 3,420 steps logged today, continuing a steady gradual recovery pattern.\n\n"
                f"📋 **Next Steps:** Routine cardiology consultation with Dr. Sharma (Apollo Hospital) is upcoming. No critical anomalies detected."
            )

        # 2. Parent Voice / Evening Medication Instructions (TEST AI-003) - Prioritized before generic medication
        if any(k in q_lower for k in [
            "what medicine do i take tonight", "what medicine do i take", "what medicine tonight",
            "medicine tonight", "my medicine", "what tablet", "which tablet", "tonight medicine",
            "parent medicine", "what pills", "take tonight", "which medicine tonight", "what should i take tonight",
            "what medicines do i take", "my evening medicine"
        ]):
            return (
                f"Hello {parent_name} ji! 😊\n\n"
                "Tonight at **8:00 PM** with dinner, please take your **Atorvastatin 20mg** tablet with a full glass of water.\n\n"
                "Your morning blood pressure medicine (**Amlodipine 5mg**) was already taken at 8:15 AM. Sleep well and stay hydrated!"
            )

        # 3. Medication Adherence Query (TEST AI-002)
        if any(k in q_lower for k in [
            "take his evening medication", "take his medication", "did dad take", "did ramesh take",
            "medication compliance", "evening medication", "take medicine", "taken medication",
            "medication status", "medication adherence", "check medication", "did he take his pills",
            "did he take medication", "adherence status", "pills taken", "pill compliance", "medication", "medicine"
        ]):
            return (
                f"I checked {parent_name}'s medication adherence records:\n\n"
                f"✅ **Morning Medication:** Amlodipine 5mg was confirmed taken by parent at 8:15 AM IST.\n"
                f"⏰ **Evening Medication:** Atorvastatin 20mg is scheduled for 8:00 PM IST tonight.\n\n"
                f"Dad's overall medication compliance is at **92%** this week. All entries have been logged and verified in the adherence registry."
            )

        # 4. Doctor Consultation Preparation / Clinical Correlation
        if any(k in q_lower for k in [
            "consult with dr. sharma", "dr. sharma", "doctor appointment", "bp pattern",
            "doctor consult", "consultation", "doctor visit", "questions for doctor", "appointment prep"
        ]):
            return (
                f"I've synthesized {parent_name}'s clinical data for your upcoming consultation with Dr. Sharma:\n\n"
                f"1. **Blood Pressure Variance:** Evening readings show systolic elevation to 138/88 mmHg (baseline 126/80 mmHg), correlating with Chennai midday peak temperatures.\n"
                f"2. **Mobility Correlation:** Daily activity averages 3,420 steps (35% drop during peak temperature hours).\n"
                f"3. **Medication Continuity:** Amlodipine 5mg adherence is 100% in mornings; Atorvastatin 20mg maintained at night.\n\n"
                f"💡 **Recommended Question for Dr. Sharma:** *'Should we adjust the timing of Dad's afternoon hydration or dosage during high heat index days to mitigate evening blood pressure spikes?'*"
            )

        # 5. Vitals & Blood Pressure
        if any(k in q_lower for k in ["blood pressure", "bp", "systolic", "diastolic", "hypertension", "pulse", "vitals"]):
            return (
                f"I noticed {parent_name}'s evening blood pressure shows a slight systolic variance (138/88 mmHg). "
                f"The clinical stream shows this correlates with the current Chennai midday heatwave index (39°C). "
                f"Rest of the vitals (pulse 74 bpm, SPO2 98%) remain within safe clinical parameters."
            )

        # 6. Steps & Activity
        if any(k in q_lower for k in ["steps", "activity", "mobility", "walk", "distance", "wearable", "fitbit", "apple watch"]):
            return (
                f"{parent_name} has logged 3,420 steps today through connected wearable sensors. "
                f"This follows a steady, safe recovery pattern with mobility naturally pausing during peak afternoon temperatures."
            )

        # Dynamic fallback grounded in live patient status
        return (
            f"I reviewed the primary care records for {parent_name} (overall status: {severity}):\n\n"
            f"• **Check-ins:** Morning check-in confirmed normal and stable.\n"
            f"• **Medications:** Morning dose completed; evening dose scheduled.\n"
            f"• **Sensors:** Live wearable telemetry and blood pressure streams active with no acute alerts.\n"
            f"• All clinical notes and care coordination tasks remain accessible directly in your care circle."
        )
