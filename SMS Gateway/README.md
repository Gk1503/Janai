# SMS Gateway

Turn an Android phone into an SMS gateway for your own projects (OTP, promotions, two-way SMS).

```
backend/   Node API + dashboard (SQLite, no external services)
mobile/    Expo (React Native) Android app + native Kotlin module that talks to the SIM
```

## 1. Run the backend

Requires Node 22.5+ (uses the built-in `node:sqlite`).

```bash
cd backend
npm install
npm start            # http://localhost:4000  (dashboard + API)
npm test             # end-to-end smoke test
```

Open the dashboard, create an account, and generate an **API key**.

For the phone to reach the server, use your PC's LAN IP (e.g. `http://192.168.1.10:4000`) while testing, or deploy
the backend somewhere with HTTPS for real use. Persist the `DATA_DIR` folder (default `backend/data`).

## 2. Build the Android app

Expo Go cannot send SMS, so you need a real build (the app contains native code).

```bash
cd mobile
npm install
npx expo run:android --device          # needs Android Studio / SDK + JDK 17, phone with USB debugging
# or, cloud build that produces an installable .apk:
npx eas-cli build -p android --profile preview
```

On the phone: enter the server URL + API key -> **Connect** -> **Start gateway** -> allow SMS permissions ->
set battery to "Unrestricted". The device shows as *online* in the dashboard.

## 3. Use the API

```bash
# send an SMS
curl -X POST http://localhost:4000/v1/messages \
  -H "x-api-key: sg_..." -H "content-type: application/json" \
  -d '{"to":"+919876543210","body":"Big sale today!"}'

# check status: pending -> processing -> sent -> delivered | failed
curl http://localhost:4000/v1/messages/<id> -H "x-api-key: sg_..."

# OTP login flow (the gateway generates, sends and verifies the code)
POST /v1/otp/send    {"to":"+919876543210"}              -> {"otp_id":"..."}
POST /v1/otp/verify  {"otp_id":"...","code":"123456"}    -> {"valid":true}

# list incoming SMS
GET  /v1/messages?direction=in
GET  /v1/devices
```

Set a **webhook URL** in the dashboard to get `sms.received`, `sms.sent`, `sms.delivered`, `sms.failed` as JSON
POSTs, signed with `X-SMSGateway-Signature: sha256=<HMAC-SHA256(body, webhook secret)>`.

## How it works

- Phone pairs with an API key and receives its own device token.
- A native foreground service long-polls `GET /device/poll`; new messages wake it instantly.
- It sends via `SmsManager`, and the OS callbacks (sent / delivered) are reported back.
- A native `BroadcastReceiver` forwards incoming SMS to `POST /device/incoming`, even when the app UI is closed.
- Reports go through a persistent outbox, so nothing is lost if the phone is briefly offline.

## Notes

- Google Play restricts SMS permissions; distribute the APK yourself.
- Carriers rate-limit SMS from a normal SIM. The app waits 1.5 s between messages; keep promo volume modest.
- Promotional SMS is regulated (e.g. DLT in India, TCPA in the US): get consent and honour opt-outs.
- Use HTTPS in production. Cleartext HTTP is enabled in the app only to make LAN testing easy.
