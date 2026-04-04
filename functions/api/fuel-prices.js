/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Uses OAuth 2.0 Client Credentials and Caching
*/

// GLOBAL CACHE (Persists while the server is "warm")
let cachedToken = null;
let tokenExpiry = 0;

export async function onRequest(context) {
    const { env } = context;
    const CLIENT_ID = env.FUEL_CLIENT_ID;
    const CLIENT_SECRET = env.FUEL_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: "Missing Fuel Finder API credentials in Cloudflare." }), { 
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    const cache = caches.default;
    const cacheKey = new Request("https://fuel-prices-gov-api-v2");
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    try {
        // 1. FETCH OAUTH TOKEN
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            
            // Check your developer portal welcome email to confirm this is the exact token URL
            const TOKEN_URL = "https://identity.fuel-finder.service.gov.uk/oauth2/token"; 
            
            const tokenBody = new URLSearchParams({
                grant_type: "client_credentials",
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                scope: "fuelfinder.read"  // <--- FIXED: The Gov API requires this scope!
            });

            const tokenRes = await fetch(TOKEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: tokenBody
            });

            // FIXED: Show the actual error message from the government server if this fails
            if (!tokenRes.ok) {
                const errorText = await tokenRes.text();
                throw new Error(`Auth Error (${tokenRes.status}): ${errorText}`);
            }

            const tokenData = await tokenRes.json();
            cachedToken = tokenData.access_token;
            tokenExpiry = now + ((tokenData.expires_in || 3600) - 60) * 1000;
        }

        // 2. FETCH FUEL DATA
        const API_URL = "https://api.fuelfinder.service.gov.uk/v1/forecourts";

        const apiRes = await fetch(API_URL, {
            headers: {
                "Authorization": `Bearer ${cachedToken}`,
                "Accept": "application/json"
            }
        });

        if (!apiRes.ok) {
            const errorText = await apiRes.text();
            throw new Error(`Data Fetch Error (${apiRes.status}): ${errorText}`);
        }

        const data = await apiRes.json();

        // 3. MAP DATA TO FRONTEND FORMAT
        const rawStations = data.forecourts || data.stations || data || [];
        
        const mappedStations = rawStations.map(station => ({
            site_id: station.site_id || station.id || Math.random().toString(36).substr(2, 9),
            brand: station.brand || station.operator || "Unknown",
            address: station.address || "Unknown Address",
            postcode: station.postcode || "",
            location: {
                latitude: station.location?.latitude || station.latitude || 0,
                longitude: station.location?.longitude || station.longitude || 0
            },
            prices: station.prices || {}
        }));

        // 4. CREATE RESPONSE
        const json = JSON.stringify({ 
            updated: new Date().toISOString(),
            count: mappedStations.length,
            stations: mappedStations 
        });

        response = new Response(json, {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*", 
                "Cache-Control": "public, max-age=1800" 
            }
        });

        context.waitUntil(cache.put(cacheKey, response.clone()));
        return response;

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
    }
}