/* CLOUDFLARE PAGES FUNCTION 
   This runs securely on the server. Your keys are safe here.
*/

export async function onRequestPost({ request, env }) {
    try {
      const { registration } = await request.json();
  
      // 1. GET THESE FROM CLOUDFLARE ENVIRONMENT VARIABLES
      // (We will set these in the Cloudflare Dashboard later)
      const CLIENT_ID = env.DVSA_CLIENT_ID;
      const CLIENT_SECRET = env.DVSA_CLIENT_SECRET;
      const API_KEY = env.DVSA_API_KEY;
      
      // Hardcoded URLs (Public knowledge)
      const TOKEN_URL = "https://login.microsoftonline.com/a455b827-244f-4c97-b5b4-ce5d13b4d00c/oauth2/v2.0/token";
      const SCOPE = "https://tapi.dvsa.gov.uk/.default";
      const MOT_URL = "https://history.mot.api.gov.uk/v1/trade/vehicles/registration";
  
      if (!CLIENT_ID || !CLIENT_SECRET) {
        return new Response(JSON.stringify({ error: "Server misconfigured: Missing Keys" }), { status: 500 });
      }
  
      // 2. GET MICROSOFT TOKEN
      const tokenBody = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: SCOPE
      });
  
      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody
      });
  
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error("Failed to get Access Token");
  
      // 3. GET VEHICLE DATA
      const motRes = await fetch(`${MOT_URL}/${registration}`, {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "X-API-Key": API_KEY,
          "Accept": "application/json+v6"
        }
      });
  
      const motData = await motRes.json();
      return new Response(JSON.stringify(motData), { headers: { "Content-Type": "application/json" } });
  
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }