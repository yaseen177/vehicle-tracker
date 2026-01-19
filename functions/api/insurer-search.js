/* CLOUDFLARE PAGES FUNCTION 
   Securely searches Logo.dev using the Secret Key
*/

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q");
  
    if (!query || query.length < 2) {
      return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
    }
  
    const SECRET_KEY = env.LOGO_DEV_SK; // Add this to your Cloudflare Env Variables
  
    try {
      const response = await fetch(`https://api.logo.dev/search?q=${encodeURIComponent(query)}`, {
        headers: {
          "Authorization": `Bearer ${SECRET_KEY}`
        }
      });
  
      if (!response.ok) throw new Error("Logo API Error");
      
      const data = await response.json();
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }