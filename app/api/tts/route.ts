import { NextRequest } from 'next/server';
export const runtime = 'nodejs';

function isPlaceholder(k: string) {
  const s = k.toLowerCase();
  return s.includes('your-api') || s.includes('placeholder') || s.endsWith('here');
}

export async function POST(req: NextRequest) {
  try {
    const { text, voice = 'alloy', format = 'mp3' } = await req.json();
    if (!text || typeof text !== 'string')
      return new Response(JSON.stringify({ error: 'text is required' }), { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY || '';
    if (!apiKey || isPlaceholder(apiKey)) {
      return new Response(JSON.stringify({
        error: 'Missing or placeholder OPENAI_API_KEY on server'
      }), { status: 500 });
    }

    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice, format, input: text })
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('OpenAI TTS error:', detail); // 서버 로그에만 남김
      return new Response(JSON.stringify({ error: 'OpenAI TTS error' }), { status: r.status });
    }

    const buf = await r.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: { 'Content-Type': format === 'wav' ? 'audio/wav' : 'audio/mpeg', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    console.error('TTS route server error:', e);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
}
