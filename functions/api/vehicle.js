/* CLOUDFLARE PAGES FUNCTION 
   Merges DVSA (MOT) and DVLA (Tax) data.
   Optimized with In-Memory Caching.
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
    const MOT_API_KEY = env.DVSA_API_KEY; 
    const VES_API_KEY = env.VES_API_KEY;  
    
    // URL Constants
    const TOKEN_URL = "https://login.microsoftonline.com/a455b827-244f-4c97-b5b4-ce5d13b4d00c/oauth2/v2.0/token";
    const SCOPE = "https://tapi.dvsa.gov.uk/.default";
    const MOT_URL = "https://history.mot.api.gov.uk/v1/trade/vehicles/registration";
    const TAX_URL = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";

    if (!CLIENT_ID || !CLIENT_SECRET || !VES_API_KEY) {
      return new Response(JSON.stringify({ error: "Server misconfigured: Missing Keys" }), { status: 500 });
    }

    // 2. CHECK OAUTH CACHE (For DVSA MOT API)
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

      cachedToken = tokenData.access_token;
      tokenExpiry = now + (55 * 60 * 1000); 
    }

    // 3. PARALLEL FETCH (Get MOT and Tax data at the same time)
    const [motResult, taxResult] = await Promise.allSettled([
      // A. Fetch MOT History
      fetch(`${MOT_URL}/${registration}`, {
        headers: {
          "Authorization": `Bearer ${cachedToken}`,
          "X-API-Key": MOT_API_KEY,
          "Accept": "application/json+v6"
        }
      }).then(async res => {
          if (!res.ok) throw new Error(res.status);
          return res.json();
      }),

      // B. Fetch Tax Data (DVLA)
      fetch(TAX_URL, {
        method: "POST",
        headers: {
          "x-api-key": VES_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ registrationNumber: registration })
      }).then(async res => {
          if (!res.ok) throw new Error(res.status);
          return res.json();
      })
    ]);

    // 4. PROCESS RESULTS
    const motData = motResult.status === 'fulfilled' ? motResult.value : null;
    const taxData = taxResult.status === 'fulfilled' ? taxResult.value : null;

    if (!motData && !taxData) {
        return new Response(JSON.stringify({ error: "Vehicle not found" }), { status: 404 });
    }

    // 5. MERGE DATA
    const mergedVehicle = {
      registration: taxData?.registrationNumber || motData?.registration || registration,
      
      make: taxData?.make || motData?.make || "Unknown",
      model: motData?.model || "Unknown", 
      
      primaryColour: taxData?.colour || motData?.primaryColour,
      fuelType: taxData?.fuelType || motData?.fuelType,
      engineSize: taxData?.engineCapacity || motData?.engineSize,
      
      manufactureDate: taxData?.yearOfManufacture || motData?.manufactureDate,
      firstUsedDate: taxData?.monthOfFirstRegistration || motData?.firstUsedDate,
      
      // *** TAX & SORN STATUS ***
      taxStatus: taxData?.taxStatus || "Unknown", // <--- NEW FIELD ADDED HERE
      taxDueDate: taxData?.taxDueDate || "",      
      
      // MOT History
      motTests: motData?.motTests || []
    };

    return new Response(JSON.stringify(mergedVehicle), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}