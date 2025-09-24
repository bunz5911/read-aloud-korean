console.log('API Key check:', {
  exists: !!process.env.OPENAI_API_KEY,
  starts_with_sk: process.env.OPENAI_API_KEY?.startsWith('sk-'),
  length: process.env.OPENAI_API_KEY?.length,
  preview: process.env.OPENAI_API_KEY?.substring(0, 10) + '...'
});

// app/api/correct/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type SpeechLevel = 'banmal' | 'jondaetmal';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7일
const CACHE_VERSION = 'v4';
const cache = new Map<string, { value: { result: string; notes: string[] }, expires: number }>();

/* ---------- 한글 유틸 ---------- */
const HANGUL_BASE = 0xac00;
const JUNGSUNG = 28;
function isHangulChar(ch: string) {
  const code = ch.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3;
}
function hasBatchim(word: string) {
  for (let i = word.length - 1; i >= 0; i--) {
    const ch = word[i];
    if (!isHangulChar(ch)) continue;
    const code = ch.charCodeAt(0) - HANGUL_BASE;
    const jong = code % JUNGSUNG;
    return jong !== 0;
  }
  return false;
}
function jongIndex(word: string) {
  for (let i = word.length - 1; i >= 0; i--) {
    const ch = word[i];
    if (!isHangulChar(ch)) continue;
    const code = ch.charCodeAt(0) - HANGUL_BASE;
    return code % JUNGSUNG;
  }
  return 0;
}
function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, ' ').replace(/\s([,.!?])/g, '$1').trim();
}

/* ---------- 룰 기반 교정 ---------- */
type TimeHint = 'past' | 'present' | 'future' | 'neutral';
function getTimeHint(s: string): TimeHint {
  const past = /(어제|아까|방금|지난\s*\w+)/;
  const future = /(내일|모레|곧|훗날|\d+\s*일\s*후|\d+\s*시간\s*후)/;
  const present = /(지금|현재|요즘)/;
  if (past.test(s)) return 'past';
  if (future.test(s)) return 'future';
  if (present.test(s)) return 'present';
  return 'neutral';
}
function fixParticles(input: string) {
  let s = input;

  // 이/가
  s = s.replace(/([가-힣]+)([이가])(\b)/g, (_m, w, _p, tail) => {
    const correct = hasBatchim(w) ? '이' : '가';
    return w + correct + tail;
  });

  // 을/를
  s = s.replace(/([가-힣]+)([을를])(\b)/g, (_m, w, _p, tail) => {
    const correct = hasBatchim(w) ? '을' : '를';
    return w + correct + tail;
  });

  // 은/는
  s = s.replace(/([가-힣]+)([은는])(\b)/g, (_m, w, _p, tail) => {
    const correct = hasBatchim(w) ? '은' : '는';
    return w + correct + tail;
  });

  // 와/과
  s = s.replace(/([가-힣]+)([와과])(\b)/g, (_m, w, _p, tail) => {
    const correct = hasBatchim(w) ? '과' : '와';
    return w + correct + tail;
  });

  // 로/으로 (받침 ㄹ 예외)
  s = s.replace(/([가-힣]+)(으로|로)(\b)/g, (_m, w, _p, tail) => {
    const j = jongIndex(w);
    const correct = j === 0 || j === 8 ? '로' : '으로';
    return w + correct + tail;
  });

  // 호격 아/야 (단순)
  s = s.replace(/([가-힣]+)(아|야)([\s,!?\.])/g, (_m, w, _p, tail) => {
    const correct = hasBatchim(w) ? '아' : '야';
    return w + correct + tail;
  });

  return s;
}
function enforceTense(s: string, hint: TimeHint) {
  let out = s;
  if (hint === 'past') {
    out = out
      .replace(/갈\s?거(야|다|예요|에요)/g, '갔다')
      .replace(/가겠(다|어요|습니다)/g, '갔다')
      .replace(/간다/g, '갔다')
      .replace(/가요/g, '갔어요');
  }
  if (hint === 'future') {
    out = out
      .replace(/갔었?다/g, '갈 거다')
      .replace(/갔어요/g, '갈 거예요')
      .replace(/갔다/g, '갈 거다');
  }
  return out;
}
function ruleBasedCorrect(text: string): { corrected: string; notes: string[] } {
  const notes: string[] = [];
  let s = normalizeSpaces(text);

  const beforeParticles = s;
  s = fixParticles(s);
  if (s !== beforeParticles) notes.push('조사를 받침 규칙에 맞게 수정했어요.');

  const hint = getTimeHint(s);
  const beforeTense = s;
  s = enforceTense(s, hint);
  if (s !== beforeTense) {
    if (hint === 'past') notes.push('시간 부사(예: 어제)에 맞춰 과거 시제로 바꿨어요.');
    if (hint === 'future') notes.push('시간 부사(예: 내일)에 맞춰 미래 시제로 바꿨어요.');
  }

  if (!/[.!?]$/.test(s)) s += '.';
  return { corrected: s, notes };
}

/* ---------- 말투 보정 세이프티넷 ---------- */
function enforceSpeechLevelServer(textRaw: string, level: SpeechLevel): string {
  let t = (textRaw || '').trim();
  t = t.replace(/\s+/g, ' ').replace(/\s([,.!?])/g, '$1').replace(/[“”"]/g, '');
  if (!/[.!?]$/.test(t)) t += '.';
  t = t.replace(/거에요/g, '거예요');

  if (level === 'jondaetmal') {
    t = t
      .replace(/것이다([.!?])?$/g, '거예요$1')
      .replace(/거다([.!?])?$/g, '거예요$1')
      .replace(/했다([.!?])?$/g, '했어요$1')
      .replace(/한다([.!?])?$/g, '해요$1')
      .replace(/갔다([.!?])?$/g, '갔어요$1');

    if (!/(요|니다)[.!?]$/.test(t)) t = t.replace(/다([.!?])$/g, '요$1');
    return t;
  } else {
    t = t
      .replace(/것이다([.!?])?$/g, '거야$1')
      .replace(/거다([.!?])?$/g, '거야$1')
      .replace(/거예요([.!?])?$/g, '거야$1')
      .replace(/했어요([.!?])?$/g, '했어$1')
      .replace(/해요([.!?])?$/g, '해$1')
      .replace(/합니다([.!?])?$/g, '한다$1')
      .replace(/요([.!?])$/g, '$1');

    if (!/[.!?]$/.test(t)) t += '.';
    return t;
  }
}

/* ---------- OpenAI 호출 ---------- */
async function callOpenAI(prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      temperature: 0.1,
      max_tokens: 80,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 한국어 문장 교정기입니다.',
            '문법·시제·조사 오류를 고치고, 요청된 말투로 자연스럽게 바꿉니다.',
            '시간 부사와 동사 시제가 충돌하면 반드시 일치시킵니다.',
            '출력은 오직 교정된 한 문장만. 설명·따옴표·메타텍스트 금지.',
            '말투 규칙:',
            '- 존댓말: 해요체(문장 끝이 “요” 또는 “습니다/입니다”).',
            '- 반말: 해체(“어/아/해/했어/거야/한다” 등), 문장 끝에 “요” 금지.',
          ].join('\n'),
        },
        // few-shot
        { role: 'user', content: '문장: 어제 학교 갈거다\n말투: 반말' },
        { role: 'assistant', content: '어제 학교 갔어.' },
        { role: 'user', content: '문장: 어제 학교 갈거다\n말투: 존댓말' },
        { role: 'assistant', content: '어제 학교 갔어요.' },
        { role: 'user', content: '문장: 나는 내일 아침에 밥을 먹었다\n말투: 반말' },
        { role: 'assistant', content: '나는 내일 아침에 밥을 먹을 거야.' },
        { role: 'user', content: '문장: 나는 내일 아침에 밥을 먹었다\n말투: 존댓말' },
        { role: 'assistant', content: '저는 내일 아침에 밥을 먹을 거예요.' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'OpenAI API error');
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim?.();
  if (!text) throw new Error('Empty completion');
  return text.replace(/^\"|\"$/g, '');
}

/* ---------- POST ---------- */
export async function POST(req: NextRequest) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    const { text, speechLevel }: { text: string; speechLevel: SpeechLevel } = await req.json();
    const input = (text || '').trim();
    if (!input) return NextResponse.json({ result: '', notes: [] });

    // 1) 룰 기반 1차 교정 + 노트
    const base = ruleBasedCorrect(input);

    // 캐시 체크 (입력+말투+버전+1차교정 결과 포함)
    const key = JSON.stringify({ v: CACHE_VERSION, t: base.corrected, s: speechLevel });
    const hit = cache.get(key);
    const now = Date.now();
    if (hit && hit.expires > now) {
      return NextResponse.json({ result: hit.value.result, notes: hit.value.notes, cached: true });
    }

    // 2) OpenAI 후처리 (말투/자연스러움 보정)
    const politeness =
      speechLevel === 'jondaetmal'
        ? '존댓말(해요체/합니다체 중 자연스러운 형태)'
        : '반말(친근한 구어체)';
    const userPrompt = [
      '다음 한 문장을 자연스럽게 다듬어 주세요.',
      '- 의미는 유지하고, 문법/조사/시제를 바로잡아 주세요.',
      `- 말투: ${politeness}`,
      '- 출력은 오직 교정된 한 문장만. 설명·따옴표·메타텍스트 금지.',
      '',
      `문장: ${base.corrected}`,
      `말투: ${speechLevel === 'jondaetmal' ? '존댓말' : '반말'}`,
    ].join('\n');

    const raw = await callOpenAI(userPrompt);

    // 3) 말투 세이프티넷
    const result = enforceSpeechLevelServer(raw, speechLevel);

    // 4) 캐시 + 응답
    const payload = { result, notes: base.notes };
    cache.set(key, { value: payload, expires: now + CACHE_TTL_MS });
    return NextResponse.json({ ...payload, cached: false });
  } catch (e: any) {
    console.error('교정 API 오류:', e);
    
    // OpenAI 할당량 초과 오류 처리
    if (e?.message?.includes('quota') || e?.message?.includes('insufficient_quota')) {
      return NextResponse.json({ 
        error: 'OpenAI API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.',
        type: 'quota_exceeded'
      }, { status: 429 });
    }
    
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
