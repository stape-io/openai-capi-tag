# OpenAI Ads Conversions API Tag for Google Tag Manager Server-Side

The **OpenAI Ads Conversions API Tag** for Google Tag Manager Server-Side allows you to send conversion event data from your server container directly to the **[OpenAI Ads Conversions API](https://developers.openai.com/ads/conversions-api)**. This server-to-server integration provides a more reliable and privacy-compliant way to track conversions for OpenAI (ChatGPT) ad campaigns compared to pixel-only setups.

## Features

- **Server-to-Server Events**: Sends conversion data directly from the GTM Server Container to the OpenAI Ads Conversions API.
- **Flexible Event Mapping**: Supports standard OpenAI event types, inherits and maps from GA4 event names automatically, or sends fully custom event names.
- **Automatic Data Mapping**: Intelligently maps parameters from incoming GTM event data for server event data, user identifiers, and event parameters.
- **Click ID Cookie Management**: Automatically reads and sets the `__oppref` (Click ID) cookie server-side to improve attribution.
- **PII Hashing**: Automatically hashes email addresses, phone numbers, and address fields using SHA-256 before sending. Pre-hashed values are accepted and will not be re-hashed.
- **Consent Mode Support**: Integrates with Google Consent Mode, checking for `ad_storage` consent before sending data.
- **Advanced Logging**: Provides options for logging to the GTM console for debugging and persistent logging to BigQuery for monitoring.

## Installation

1. **Download the Template**:
   - Download the `template.tpl` file from this repository.
2. **Import to GTM Server Container**:
   - In your GTM Server Container, navigate to the **Templates** section.
   - Click **New** under the **Tag Templates** section.
   - Click the **three-dot menu** in the top right and select **Import**.
   - Select the downloaded `template.tpl` file and click **Save**.
3. **Create a New Tag**:
   - Go to **Tags** and click **New**.
   - Select the newly imported **"OpenAI Ads Conversions API by Stape"** template.

## Tag Configuration

### Base Configuration

| Parameter | Description |
| :--- | :--- |
| **Event Name Setup Method** | Choose `Standard` to select a predefined event type, `Inherit from client` to automatically map from GA4 event names, or `Custom` to enter a custom event name. |
| **Pixel ID** | Your OpenAI Pixel ID from your ad account. |
| **API Key** | Your OpenAI API Key, provided by the OpenAI Account team. |
| **Action Source** | Where the event occurred: `Web`, `Mobile App`, `Offline`, `Physical Store`, `Phone Call`, or `Email`. |
| **Validate Only** | If `true`, the event is sent in test mode and excluded from measurement. |
| **Use Optimistic Scenario** | If enabled, the tag fires `gtmOnSuccess()` immediately without waiting for the API response, speeding up server response time. |

#### Standard Event Types

| Event Name |
| :--- |
| `page_viewed` |
| `appointment_scheduled` |
| `checkout_started` |
| `contents_viewed` |
| `items_added` |
| `lead_created` |
| `order_created` |
| `registration_completed` |
| `subscription_created` |
| `trial_started` |

#### GA4 → Conversions API Event Name Mapping (Inherit from client)

When using **Inherit from client**, the following GA4 event names are mapped:

| GA4 Event Name | OpenAI Conversions API Event Type |
| :--- | :--- |
| `page_view` | `page_viewed` |
| `view_item` | `contents_viewed` |
| `add_to_cart` | `items_added` |
| `begin_checkout` | `checkout_started` |
| `purchase` | `order_created` |
| `generate_lead` | `lead_created` |
| `sign_up` | `registration_completed` |
| Any other GA4 event | `custom` (with `custom_event_name` set) |

#### Custom Event Name Requirements

- Maximum 64 characters
- Accepted characters: lowercase alphanumeric, `_`, and `-`
- Cannot overlap with Standard Event Names

### Click ID Cookie Settings

Controls how the tag handles the OpenAI Click ID (`oppref`).

| Parameter | Description |
| :--- | :--- |
| **Set Click ID cookie** | If `true`, the Click ID is sent in the request and stored as the `__oppref` cookie by server GTM. If `false`, the Click ID is still sent if found but not stored as a cookie. |
| **Cookie Domain** | Override the cookie domain. Defaults to `auto`, which resolves via `page_location`, `Referer`, or `Host` headers. |
| **Cookie SameSite** | `None`, `Lax` (default), or `Strict`. |
| **Cookie HTTP Only** | Whether to set the `HttpOnly` flag on the cookie. Defaults to `false`. |
| **Cookie Expiration** | Number of days until the cookie expires. Defaults to `30`. |

The Click ID (`oppref`) is sourced in the following priority order:

1. **User Identifiers Parameters** section (manual override)
2. `oppref` URL parameter
3. `__oppref` cookie
4. `common_cookie.__oppref` Event Data parameter
5. `__oppref` Event Data parameter
6. `oppref` Event Data parameter

### Server Event Data Parameters

| Parameter | Description |
| :--- | :--- |
| **Opt Out** | When `true`, the event is marked as opted out. |
| **Automap Server Event Data Parameters** | If enabled, automatically sets `Event Timestamp` (Unix timestamp in ms), `Source URL` (from `eventData.page_location`), `Event ID` (from `eventData.event_id` or `eventData.eventId`), and `Click ID` (from `oppref` sources). |
| **Server Event Data Parameters** | Manually override or add `Event Timestamp`, `Event ID`, `Click ID`, and `Source URL`. Manual values always take precedence over auto-mapped ones. |

> **Note:** `Timestamp` cannot be more than 7 days in the past or 10 minutes into the future. `Source URL` is **required** when **Action Source** is set to `Web`.

### User Data Parameters

| Parameter | Description |
| :--- | :--- |
| **Automap User Data Parameters** | If enabled, automatically maps Email, Phone, City, ZIP Code, Country, External ID, IP Address, and User Agent from the Event Data. |
| **User Identifiers Parameters** | Manually specify user identifiers. Supported fields: `Email Address`, `Phone Number`, `External ID`, `External ID (SHA256 Hashed)`, `City`, `ZIP Code`, `Country`, `IP Address`, `User Agent`. |

**Auto-mapping sources:**

| Field | Event Data Sources |
| :--- | :--- |
| Email | `email`, `email_address`, `user_data.email`, `user_data.email_address`, `user_data.sha256_email_address` |
| Phone | `phone`, `phone_number`, `user_data.phone`, `user_data.phone_number`, `user_data.sha256_phone_number` |
| City | `user_data.address.city` |
| ZIP Code | `user_data.address.postal_code` |
| Country | `user_data.address.country` |
| External ID | `user_id` |
| IP Address | `ip_override` |
| User Agent | `user_agent` |

The tag automatically hashes the following fields using SHA-256 before sending: Email, Phone, External ID (SHA256), City, ZIP Code, Country. Pre-hashed values (64-character hex strings) are detected and will not be re-hashed.

### Event Parameters

| Parameter | Description |
| :--- | :--- |
| **Automap Event Parameters** | If enabled, automatically maps `Amount` (from `eventData.value` or sum of `items price × quantity`), `Currency` (from `eventData.currency` or items), and `Contents` (from `eventData.items`). |
| **Custom Item ID Key** | Optional. Override the item ID field key used when mapping items. Defaults to `item_id`. Useful for WooCommerce setups. |
| **Event Parameters** | Manually specify `Amount`, `Currency`, `Contents`, and `Plan ID`. |

> **Note:** `Currency` is required when `Amount` is used. Each item in `Contents` must have `content_type` defined.

## Useful Resources

- [OpenAI Docs: OpenAI Ads Conversions API](https://developers.openai.com/ads/conversions-api)
- [OpenAI Docs: Supported Events](https://developers.openai.com/ads/supported-events)

## Open Source

The **OpenAI Ads Conversions API Tag for GTM Server-Side** is developed and maintained by the [Stape Team](https://stape.io/) under the Apache 2.0 license.

### GTM Gallery Status
🔴 Not listed
