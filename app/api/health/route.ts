export const runtime = 'nodejs';
export async function GET() {
  const key = process.env.OPENAI_API_KEY || '';
  console.log('Health check - API key length:', key.length);
  console.log('Health check - API key starts with sk-:', key.startsWith('sk-'));
  console.log('Health check - First 10 chars:', key.substring(0, 10));
  
  const masked = key ? key.slice(0,7)+'...'+key.slice(-4) : 'NONE';
  return new Response(JSON.stringify({ 
    hasKey: !!key, 
    keyPreview: masked,
    keyLength: key.length,
    startsWithSk: key.startsWith('sk-')
  }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}
