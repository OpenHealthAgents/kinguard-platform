"""Official WhatsApp Business Platform Cloud API Adapter for KinGuardian.

Handles:
- Template message formatting & delivery via Meta Graph API v21.0
- Phone number normalization and E.164 international validation
- Delivery status tracking: not_configured, accepted, failed, temporarily_unavailable
- Mock provider mode for local development and CI testing
"""
import hashlib
import hmac
import logging
import re
from dataclasses import dataclass
from typing import Any
import httpx
from app.config import settings

logger = logging.getLogger("kinguardian.whatsapp")


@dataclass
class WhatsAppSendResult:
    status: str  # "accepted", "not_configured", "failed", "temporarily_unavailable"
    message_id: str | None = None
    detail: str | None = None
    recipient_phone: str | None = None


def normalize_phone_number(raw_phone: str) -> str:
    """Normalize phone number to E.164 format (+[country_code][number]).

    Strips spaces, hyphens, parentheses, and leading zeros from national part.
    Raises ValueError if number is malformed or missing country code.
    """
    if not raw_phone or not isinstance(raw_phone, str):
        raise ValueError("Phone number must be a non-empty string.")

    cleaned = re.sub(r"[\s\-\(\)\.]", "", raw_phone.strip())
    if not cleaned.startswith("+"):
        # If national format without '+', ensure caller explicitly passes country code
        if cleaned.startswith("00"):
            cleaned = "+" + cleaned[2:]
        else:
            raise ValueError(
                f"Phone number '{raw_phone}' must include international '+' prefix and country code (e.g. +91XXXXXXXXXX or +1XXXXXXXXXX)."
            )

    # Validate E.164 format: + followed by 7 to 15 digits
    if not re.match(r"^\+[1-9]\d{6,14}$", cleaned):
        raise ValueError(
            f"Phone number '{raw_phone}' is not a valid international E.164 phone number."
        )

    return cleaned


class WhatsAppCloudAdapter:
    """Production & Mock adapter for Meta WhatsApp Business Platform Cloud API."""

    def __init__(
        self,
        phone_number_id: str | None = None,
        access_token: str | None = None,
        api_version: str | None = None,
        template_name: str | None = None,
        template_language: str | None = None,
        app_secret: str | None = None,
        mock_mode: bool = False
    ):
        self.phone_number_id = phone_number_id if phone_number_id is not None else settings.whatsapp_phone_number_id
        self.access_token = access_token if access_token is not None else settings.whatsapp_access_token
        self.api_version = api_version if api_version is not None else settings.whatsapp_api_version
        self.template_name = template_name if template_name is not None else settings.whatsapp_invite_template_name
        self.template_language = template_language if template_language is not None else settings.whatsapp_template_language
        self.app_secret = app_secret if app_secret is not None else settings.meta_app_secret
        self.mock_mode = mock_mode
        self.sent_messages: list[dict[str, Any]] = []

    @property
    def is_configured(self) -> bool:
        """Returns True if required credentials exist and are non-empty."""
        return bool(self.phone_number_id and self.access_token)

    async def send_parent_invitation(
        self,
        parent_phone: str,
        parent_name: str,
        coordinator_name: str,
        family_name: str,
        invite_url: str
    ) -> WhatsAppSendResult:
        """Send WhatsApp template message inviting parent to the family care circle."""
        try:
            normalized_phone = normalize_phone_number(parent_phone)
        except ValueError as val_err:
            return WhatsAppSendResult(
                status="failed",
                detail=str(val_err)
            )

        if self.mock_mode:
            import uuid
            mock_wamid = f"wamid.mock_{uuid.uuid4().hex[:16]}"
            record = {
                "to": normalized_phone,
                "parent_name": parent_name,
                "coordinator_name": coordinator_name,
                "family_name": family_name,
                "invite_url": invite_url,
                "message_id": mock_wamid
            }
            self.sent_messages.append(record)
            logger.info("Mock WhatsApp invitation recorded for %s (%s)", parent_name, normalized_phone)
            return WhatsAppSendResult(
                status="accepted",
                message_id=mock_wamid,
                detail="Mock WhatsApp provider accepted message template",
                recipient_phone=normalized_phone
            )

        if not self.is_configured:
            return WhatsAppSendResult(
                status="not_configured",
                detail="WhatsApp Business Platform credentials are not configured on this server.",
                recipient_phone=normalized_phone
            )

        # Build payload according to Meta Graph API specification
        url = f"https://graph.facebook.com/{self.api_version}/{self.phone_number_id}/messages"
        # Meta expects recipient phone number without leading '+'
        recipient_to = normalized_phone.lstrip("+")

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_to,
            "type": "template",
            "template": {
                "name": self.template_name,
                "language": {"code": self.template_language},
                "components": [
                    {
                        "type": "body",
                        "parameters": [
                            {"type": "text", "text": parent_name},
                            {"type": "text", "text": coordinator_name},
                            {"type": "text", "text": family_name},
                            {"type": "text", "text": invite_url}
                        ]
                    }
                ]
            }
        }

        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}

                if resp.status_code == 200:
                    messages = data.get("messages", [])
                    message_id = messages[0].get("id") if messages else None
                    return WhatsAppSendResult(
                        status="accepted",
                        message_id=message_id,
                        detail="WhatsApp Cloud API accepted template message.",
                        recipient_phone=normalized_phone
                    )

                error_data = data.get("error", {})
                error_msg = error_data.get("message", f"HTTP {resp.status_code}")
                error_code = error_data.get("code")

                if resp.status_code in (408, 500, 502, 503, 504):
                    return WhatsAppSendResult(
                        status="temporarily_unavailable",
                        detail=f"Meta WhatsApp service temporarily unavailable: {error_msg} (code {error_code})",
                        recipient_phone=normalized_phone
                    )

                return WhatsAppSendResult(
                    status="failed",
                    detail=f"WhatsApp Cloud API rejected send request: {error_msg} (code {error_code})",
                    recipient_phone=normalized_phone
                )

        except (httpx.TimeoutException, httpx.NetworkError) as net_err:
            logger.warning("WhatsApp API network error: %s", net_err)
            return WhatsAppSendResult(
                status="temporarily_unavailable",
                detail=f"Network error connecting to Meta WhatsApp Cloud API: {type(net_err).__name__}",
                recipient_phone=normalized_phone
            )
        except Exception as ex:
            logger.error("Unexpected error in WhatsApp Cloud API send: %s", ex, exc_info=True)
            return WhatsAppSendResult(
                status="failed",
                detail=f"Unexpected error sending WhatsApp message: {str(ex)}",
                recipient_phone=normalized_phone
            )

    def verify_webhook_signature(self, raw_body: bytes, signature_header: str | None) -> bool:
        """Verify Meta's X-Hub-Signature-256 HMAC-SHA256 signature."""
        if not self.app_secret:
            logger.warning("META_APP_SECRET not set; cannot verify webhook signature.")
            return False

        if not signature_header or not signature_header.startswith("sha256="):
            return False

        expected_sig = signature_header[7:]
        mac = hmac.new(self.app_secret.encode("utf-8"), msg=raw_body, digestmod=hashlib.sha256)
        computed_sig = mac.hexdigest()

        return hmac.compare_digest(computed_sig, expected_sig)


whatsapp_adapter = WhatsAppCloudAdapter()
