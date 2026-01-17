/* CLOUDFLARE PAGES FUNCTION 
Optimized with In-Memory Caching to speed up searches.
*/

// GLOBAL CACHE (Persists while the server is "warm")
let cachedToken = null;
let tokenExpiry = 0;

export async function onRequestPost({ request, env }) {
  try {
    const { registration } = await request.json();

    // 1. GET KEYS
    const CLIENT_ID = env.DVSA_CLIENT_ID;
    const CLIENT_SECRET = env.DVSA_CLIENT_SECRET;
    const API_KEY = env.DVSA_API_KEY;
    
    // URL Constants
    const TOKEN_URL = "https://login.microsoftonline.com/a455b827-244f-4c97-b5b4-ce5d13b4d00c/oauth2/v2.0/token";
    const SCOPE = "https://tapi.dvsa.gov.uk/.default";
    const MOT_URL = "https://history.mot.api.gov.uk/v1/trade/vehicles/registration";

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: "Server misconfigured: Missing Keys" }), { status: 500 });
    }

    // 2. CHECK CACHE (The Speed Optimization)
    // If we have a token and it's not expired, SKIP the Microsoft call
    const now = Date.now();
    
    if (!cachedToken || now >= tokenExpiry) {
      console.log("Token expired or missing. Fetching new one...");
      
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

      // Save token to global cache
      cachedToken = tokenData.access_token;
      // Set expiry to 55 minutes from now (tokens usually last 60 mins)
      tokenExpiry = now + (55 * 60 * 1000); 
    } else {
      console.log("Using cached token (Speed boost!)");
    }

    // 3. GET VEHICLE DATA (Using the token)
    const motRes = await fetch(`${MOT_URL}/${registration}`, {
      headers: {
        "Authorization": `Bearer ${cachedToken}`,
        "X-API-Key": API_KEY,
        "Accept": "application/json+v6"
      }
    });

    // Handle 404 (Vehicle not found) explicitly
    if (motRes.status === 404) {
        return new Response(JSON.stringify({ error: "Vehicle not found" }), { status: 404 });
    }

    const motData = await motRes.json();
    return new Response(JSON.stringify(motData), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}