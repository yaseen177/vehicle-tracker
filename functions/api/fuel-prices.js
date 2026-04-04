/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Diagnostic Token Hunter & WAF Bypass
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
    // Cache bust to v15
    const cacheKey = new Request("https://fuel-prices-gov-api-v15");
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    // FIREWALL BYPASS HEADERS
    const COMMON_HEADERS = {
        "User-Agent": "VehicleTrackerAPIClient/1.0",
        "Accept": "application/json",
        "Connection": "keep-alive"
    };

    try {
        // 1. DIAGNOSTIC TOKEN HUNTER
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            
            // The Form Encoded Payload
            const formBody = new URLSearchParams();
            formBody.append("grant_type", "client_credentials");
            formBody.append("client_id", CLIENT_ID);
            formBody.append("client_secret", CLIENT_SECRET);
            formBody.append("scope", "fuelfinder.read"); 

            // The JSON Payload
            const jsonBody = JSON.stringify({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: "client_credentials",
                scope: "fuelfinder.read"
            });

            // The list of all plausible UK Gov API Gateway paths
            const endpointsToTest = [
                { url: "https://www.fuel-finder.service.gov.uk/api/v1/oauth/token", type: "form" },
                { url: "https://www.fuel-finder.service.gov.uk/api/v1/token", type: "form" },
                { url: "https://www.fuel-finder.service.gov.uk/api/oauth2/token", type: "form" },
                { url: "https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token", type: "json" },
                { url: "https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_secret_token", type: "json" },
                { url: "https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_secret_token", type: "form" },
                { url: "https://identity.fuel-finder.service.gov.uk/oauth2/token", type: "form" }
            ];

            let tokenRes = null;
            let diagnostics = {}; // We will record all failures here

            for (const ep of endpointsToTest) {
                try {
                    const isForm = ep.type === "form";
                    const res = await fetch(ep.url, {
                        method: "POST",
                        headers: { 
                            ...COMMON_HEADERS, 
                            "Content-Type": isForm ? "application/x-www-form-urlencoded" : "application/json" 
                        },
                        body: isForm ? formBody : jsonBody
                    });
                    
                    if (res.ok) {
                        tokenRes = res;
                        break; // We found the working endpoint!
                    } else {
                        // Record the failure so we can analyze it
                        let text = await res.text();
                        // Truncate HTML to save space
                        if (text.includes("<!DOCTYPE html>")) text = "404 Next.js HTML Page"; 
                        diagnostics[`${ep.type.toUpperCase()}: ${ep.url}`] = `HTTP ${res.status} - ${text.substring(0, 100)}`;
                    }
                } catch (networkError) {
                    diagnostics[`${ep.type.toUpperCase()}: ${ep.url}`] = `Network Error: ${networkError.message}`;
                }
            }

            if (!tokenRes || !tokenRes.ok) {
                // If everything failed, print the entire diagnostic map to the screen!
                throw new Error(JSON.stringify(diagnostics, null, 2));
            }

            const tokenData = await tokenRes.json();
            const token = tokenData.access_token || tokenData.data?.access_token;
            const expiresIn = tokenData.expires_in || tokenData.data?.expires_in || 3600;

            if (!token) throw new Error("API returned success but no access_token found.");

            cachedToken = token;
            tokenExpiry = now + (expiresIn - 60) * 1000;
        }

        // 2. FETCH ALL UK DATA
        const allLocations = [];
        const allPrices = {};
        
        for (let batch = 1; batch <= 20; batch++) {
            const fetchOptions = {
                headers: { ...COMMON_HEADERS, "Authorization": `Bearer ${cachedToken}` }
            };

            const [pfsRes, pricesRes] = await Promise.all([
                fetch(`https://www.fuel-finder.service.gov.uk/api/v1/pfs?batch-number=${batch}`, fetchOptions),
                fetch(`https://www.fuel-finder.service.gov.uk/api/v1/pfs/fuel-prices?batch-number=${batch}`, fetchOptions)
            ]);

            if (!pfsRes.ok || !pricesRes.ok) break;

            const pfsData = await pfsRes.json();
            const pricesData = await pricesRes.json();

            const locs = Array.isArray(pfsData) ? pfsData : (pfsData.data || []);
            const prices = Array.isArray(pricesData) ? pricesData : (pricesData.data || []);

            if (locs.length === 0) break;

            allLocations.push(...locs);
            prices.forEach(p => { if (p.node_id) allPrices[p.node_id] = p.fuel_prices || []; });
        }

        // 3. BRAND CLEANING
        const cleanBrandName = (rawName) => {
            if (!rawName) return "Unknown";
            const name = rawName.toUpperCase();
            if (name.includes("TESCO")) return "Tesco";
            if (name.includes("SAINSBURY")) return "Sainsburys";
            if (name.includes("ASDA")) return "Asda";
            if (name.includes("MORRISON")) return "Morrisons";
            if (name.includes("SHELL")) return "Shell";
            if (/\bBP\b/.test(name) || name.includes("B.P.")) return "BP";
            if (name.includes("ESSO")) return "Esso";
            if (name.includes("TEXACO")) return "Texaco";
            if (name.includes("JET")) return "Jet";
            if (name.includes("GULF")) return "Gulf";
            if (name.includes("APPLEGREEN") || name.includes("APPLE GREEN")) return "Applegreen";
            if (name.includes("COSTCO")) return "Costco";
            if (name.includes("MURCO")) return "Murco";
            if (name.includes("CO-OP") || name.includes("COOP")) return "Co-op";
            return rawName.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
        };

        // 4. FORMAT
        const mappedStations = allLocations.map(station => {
            const sid = station.node_id || station.id;
            const stationPricesArray = allPrices[sid] || [];
            let e10 = null, b7 = null;

            stationPricesArray.forEach(fp => {
                if (fp.fuel_type === 'E10' || fp.fuel_type === 'E10_STANDARD' || fp.fuel_type === 'E5') e10 = fp.price;
                if (fp.fuel_type === 'B7' || fp.fuel_type === 'B7_STANDARD') b7 = fp.price;
            });

            const lat = station.location?.latitude || station.location?.lat || station.latitude || 0;
            const lng = station.location?.longitude || station.location?.lng || station.longitude || 0;
            const rawBrand = station.trading_name || station.brand_name || "Unknown";

            return {
                site_id: sid || Math.random().toString(36).substr(2, 9),
                brand: cleanBrandName(rawBrand),
                address: station.address || "Unknown Address",
                postcode: station.postcode || "",
                location: { latitude: lat, longitude: lng },
                prices: { E10: e10, B7: b7 }
            };
        }).filter(s => (s.prices.E10 || s.prices.B7) && s.location.latitude !== 0);

        const uniqueStations = Array.from(new Map(mappedStations.map(s => [s.site_id, s])).values());

        // 5. SEND RESPONSE
        const json = JSON.stringify({ 
            updated: new Date().toISOString(), count: uniqueStations.length, stations: uniqueStations 
        });

        response = new Response(json, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=1800" } });
        context.waitUntil(cache.put(cacheKey, response.clone()));
        return response;

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
}