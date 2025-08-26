// Edge Runtime test endpoint
export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Edge Function is working!',
      timestamp: new Date().toISOString()
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    }
  );
}