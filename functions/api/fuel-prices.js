/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Fix: Added User-Agent headers to bypass AWS CloudFront WAF
*/

// GLOBAL CACHE
let cachedToken = null;
let tokenExpiry = 0;

export async function onRequest(context) {
    const { env } = context;
    const CLIENT_ID = env.FUEL_CLIENT_ID;
    const CLIENT_SECRET = env.FUEL_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: "Missing API credentials." }), { 
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    const cache = caches.default;
    // Cache bust to v8
    const cacheKey = new Request("https://fuel-prices-gov-api-v8");
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    // THE FIX: Standard Browser User-Agent to pass CloudFront Firewall
    const COMMON_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
    };

    try {
        // 1. FETCH OAUTH TOKEN
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            
            const tokenBody = new URLSearchParams();
            tokenBody.append("grant_type", "client_credentials");
            tokenBody.append("client_id", CLIENT_ID);
            tokenBody.append("client_secret", CLIENT_SECRET);
            tokenBody.append("scope", "fuelfinder.read");

            // Attempt 1: Standard OAuth Path
            let tokenRes = await fetch("https://www.fuel-finder.service.gov.uk/oauth2/token", {
                method: "POST",
                headers: { 
                    ...COMMON_HEADERS,
                    "Content-Type": "application/x-www-form-urlencoded" 
                },
                body: tokenBody
            });

            // Attempt 2: Fallback to the Secret Token Path
            if (!tokenRes.ok) {
                 tokenRes = await fetch("https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_secret_token", {
                    method: "POST",
                    headers: { 
                        ...COMMON_HEADERS,
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
                });
            }

            if (!tokenRes.ok) {
                const errorText = await tokenRes.text();
                throw new Error(`Auth Error (${tokenRes.status}): ${errorText}`);
            }

            const tokenData = await tokenRes.json();
            
            const token = tokenData.access_token || tokenData.data?.access_token;
            const expiresIn = tokenData.expires_in || tokenData.data?.expires_in || 3600;

            if (!token) throw new Error("No token returned by API.");

            cachedToken = token;
            tokenExpiry = now + (expiresIn - 60) * 1000;
        }

        // 2. FETCH DATA IN PARALLEL 
        const batches = [1, 2, 3, 4, 5];
        
        const fetchBatch = async (batchNumber) => {
            const fetchOptions = {
                headers: { 
                    ...COMMON_HEADERS,
                    "Authorization": `Bearer ${cachedToken}` 
                }
            };

            const [pfsRes, pricesRes] = await Promise.all([
                fetch(`https://www.fuel-finder.service.gov.uk/api/v1/pfs?batch-number=${batchNumber}`, fetchOptions),
                fetch(`https://www.fuel-finder.service.gov.uk/api/v1/pfs/fuel-prices?batch-number=${batchNumber}`, fetchOptions)
            ]);

            const pfsData = pfsRes.ok ? await pfsRes.json() : [];
            const pricesData = pricesRes.ok ? await pricesRes.json() : [];

            return { pfsData, pricesData };
        };

        const batchResults = await Promise.all(batches.map(fetchBatch));

        // 3. MERGE DATA
        const allLocations = [];
        const allPrices = {};

        batchResults.forEach(({ pfsData, pricesData }) => {
            const locs = Array.isArray(pfsData) ? pfsData : (pfsData.data || []);
            allLocations.push(...locs);

            const prices = Array.isArray(pricesData) ? pricesData : (pricesData.data || []);
            prices.forEach(p => {
                if (p.node_id) allPrices[p.node_id] = p.fuel_prices || [];
            });
        });

        // 4. FORMAT
        const mappedStations = allLocations.map(station => {
            const sid = station.node_id || station.id;
            const stationPricesArray = allPrices[sid] || [];
            
            let e10 = null;
            let b7 = null;

            stationPricesArray.forEach(fp => {
                if (fp.fuel_type === 'E10' || fp.fuel_type === 'E10_STANDARD' || fp.fuel_type === 'E5') e10 = fp.price;
                if (fp.fuel_type === 'B7' || fp.fuel_type === 'B7_STANDARD') b7 = fp.price;
            });

            const lat = station.location?.latitude || station.location?.lat || station.latitude || 0;
            const lng = station.location?.longitude || station.location?.lng || station.longitude || 0;

            return {
                site_id: sid || Math.random().toString(36).substr(2, 9),
                brand: station.trading_name || station.brand_name || "Unknown",
                address: station.address || "Unknown Address",
                postcode: station.postcode || "",
                location: { latitude: lat, longitude: lng },
                prices: { E10: e10, B7: b7 }
            };
        }).filter(s => (s.prices.E10 || s.prices.B7) && s.location.latitude !== 0);

        const uniqueStations = Array.from(new Map(mappedStations.map(s => [s.site_id, s])).values());

        // 5. SEND RESPONSE
        const json = JSON.stringify({ 
            updated: new Date().toISOString(),
            count: uniqueStations.length,
            stations: uniqueStations 
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