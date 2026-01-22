export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");

  if (!query || query.length < 2) return new Response(JSON.stringify([]));

  const SECRET_KEY = env.LOGO_DEV_SK;

  // TRICK: Append keywords to force relevant results
  // If user types "Admiral", we search "Admiral car insurance uk"
  const enhancedQuery = `${query} car insurance uk`;

  try {
    const response = await fetch(`https://api.logo.dev/search?q=${encodeURIComponent(enhancedQuery)}`, {
      headers: { "Authorization": `Bearer ${SECRET_KEY}` }
    });

    if (!response.ok) throw new Error("Logo API Error");
    
    const data = await response.json();
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}