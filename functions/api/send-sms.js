/* CLOUDFLARE PAGES FUNCTION: SEND SMS via TWILIO */
export async function onRequestPost({ request, env }) {
    try {
      const { to, body } = await request.json();
  
      const ACCOUNT_SID = env.TWILIO_ACCOUNT_SID;
      const FROM_NUMBER = env.FROM_NUMBER;
      const AUTH_TOKEN = env.TWILIO_AUTH_TOKEN; // Set this in Cloudflare Dashboard
  
      if (!to || !body) return new Response("Missing parameters", { status: 400 });
  
      // Twilio requires form-urlencoded body
      const params = new URLSearchParams();
      params.append("To", to);
      params.append("From", FROM_NUMBER);
      params.append("Body", body);
  
      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Authorization": "Basic " + btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`),
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: params
        }
      );
  
      if (!twilioRes.ok) {
        const err = await twilioRes.text();
        throw new Error(`Twilio Error: ${err}`);
      }
  
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }