'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic } from 'lucide-react';

type AppState = 'initial' | 'recording' | 'transcribed' | 'analyzed' | 'practice' | 'final';
type MicState = 'ok' | 'denied' | 'blocked' | 'unsupported';
type SpeechLevel = 'banmal' | 'jondaetmal';

/* ===== 룰 기반 보조 (클라이언트도 notes 보여주기용 최소 구현) ===== */
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
function fixParticles(input: string) {
  let s = input;
  s = s.replace(/([가-힣]+)([이가])(\b)/g, (_m, w, _p, tail) => (hasBatchim(w) ? w + '이' + tail : w + '가' + tail));
  s = s.replace(/([가-힣]+)([을를])(\b)/g, (_m, w, _p, tail) => (hasBatchim(w) ? w + '을' + tail : w + '를' + tail));
  s = s.replace(/([가-힣]+)([은는])(\b)/g, (_m, w, _p, tail) => (hasBatchim(w) ? w + '은' + tail : w + '는' + tail));
  s = s.replace(/([가-힣]+)([와과])(\b)/g, (_m, w, _p, tail) => (hasBatchim(w) ? w + '과' + tail : w + '와' + tail));
  s = s.replace(/([가-힣]+)(으로|로)(\b)/g, (_m, w, _p, tail) => {
    const j = jongIndex(w);
    return w + (j === 0 || j === 8 ? '로' : '으로') + tail;
  });
  s = s.replace(/([가-힣]+)(아|야)([\s,!?\.])/g, (_m, w, _p, tail) => (hasBatchim(w) ? w + '아' + tail : w + '야' + tail));
  return s;
}
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
function ruleBasedNotes(text: string): string[] {
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
  return notes;
}

export default function Page() {
  const [appState, setAppState] = useState<AppState>('initial');
  const [micState, setMicState] = useState<MicState>('blocked');
  const [isRecording, setIsRecording] = useState(false);
  const [userText, setUserText] = useState('');
  const [speechLevel, setSpeechLevel] = useState<SpeechLevel>('banmal');

  // 음성 인식 refs
  const recognitionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const finalTextRef = useRef<string>('');
  const isRecognizingRef = useRef<boolean>(false);

  // 최소 녹음 3초
  const minDurationRef = useRef<number>(3000);
  const startTimeRef = useRef<number>(0);

  // 교정결과/TTS
  const [aiText, setAiText] = useState<string>('');
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string>('');

  const [voice, setVoice] = useState<string>('alloy');
  const [ttsLoading, setTtsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 마이크/인식기 준비
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Android 브라우저 호환성 체크
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isChrome = /Chrome/i.test(navigator.userAgent);
    const isSamsung = /SamsungBrowser/i.test(navigator.userAgent);
    
    // 디버깅 정보 출력
    console.log('=== 마이크 상태 디버깅 ===');
    console.log('User Agent:', navigator.userAgent);
    console.log('Android:', isAndroid);
    console.log('Chrome:', isChrome);
    console.log('Samsung Browser:', isSamsung);
    console.log('HTTPS:', window.location.protocol === 'https:');
    console.log('Host:', window.location.host);
    console.log('MediaDevices 지원:', !!navigator.mediaDevices);
    console.log('getUserMedia 지원:', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
    
    const hasSR = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    console.log('SpeechRecognition 지원:', hasSR);
    if (!hasSR) { 
      console.log('SpeechRecognition 미지원');
      setMicState('unsupported'); 
      return; 
    }
    
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'ko-KR';
    rec.continuous = false;
    rec.interimResults = true;
    
    // 모바일 최적화 설정
    if (typeof window !== 'undefined') {
      const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (isMobile) {
        // 모바일에서 더 나은 성능을 위한 설정
        rec.maxAlternatives = 1;
        rec.grammars = null; // 문법 제한 제거로 더 유연한 인식
      }
    }
    
    recognitionRef.current = rec;

    (async () => {
      try {
        const anyNav: any = navigator as any;
        console.log('Permissions API 지원:', !!anyNav?.permissions?.query);
        
        // Android에서는 Permissions API가 제한적이므로 실제 마이크 접근으로 테스트
        if (isAndroid) {
          console.log('Android 감지 - 실제 마이크 접근으로 테스트');
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100,
                channelCount: 1,
              }
            });
            console.log('✅ Android 마이크 접근 성공 - 권한 OK');
            setMicState('ok');
            stream.getTracks().forEach(track => track.stop()); // 즉시 정리
          } catch (err) {
            console.log('❌ Android 마이크 접근 실패:', err);
            setMicState('blocked');
          }
        } else if (anyNav?.permissions?.query) {
          const status = await anyNav.permissions.query({ name: 'microphone' as any });
          console.log('마이크 권한 상태:', status.state);
          if (status.state === 'granted') {
            setMicState('ok');
            console.log('✅ 마이크 권한이 이미 허용되어 있습니다');
          } else if (status.state === 'denied') {
            setMicState('denied');
            console.log('❌ 마이크 권한이 거부되었습니다');
          } else {
            setMicState('blocked');
            console.log('⚠️ 마이크 권한이 차단되었습니다');
          }
        } else {
          console.log('Permissions API 미지원 - 실제 마이크 접근으로 테스트');
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('✅ 마이크 접근 성공 - 권한 OK');
            setMicState('ok');
            stream.getTracks().forEach(track => track.stop()); // 즉시 정리
          } catch (err) {
            console.log('❌ 마이크 접근 실패:', err);
            setMicState('blocked');
          }
        }
      } catch (err) { 
        console.error('권한 확인 오류:', err);
        setMicState('blocked'); 
      }
    })();

    return () => {
      try { recognitionRef.current?.abort?.(); } catch {}
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const cleanupMedia = () => {
    try { recognitionRef.current?.abort?.(); } catch {}
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    isRecognizingRef.current = false;
    setIsRecording(false);
  };

  const handleStartRecording = async () => {
    const rec = recognitionRef.current;
    if (!rec) { setMicState('unsupported'); return; }
    if (isRecognizingRef.current) return;

    try { rec.onresult = null; rec.onend = null; rec.onerror = null; } catch {}

    setIsRecording(true);
    setAppState('recording');
    setUserText('');
    finalTextRef.current = '';
    setAiText('');
    setAiNotes([]);
    setAiError('');
    startTimeRef.current = Date.now();

    try {
      // 모바일 최적화: 더 구체적인 오디오 제약 조건 설정
      const audioConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // 모바일에서 더 나은 성능을 위한 설정
          sampleRate: 44100,
          channelCount: 1,
        }
      };
      
      console.log('마이크 접근 시도 중...');
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia(audioConstraints);
      console.log('마이크 접근 성공');
      setMicState('ok');
    } catch (err: any) {
      setIsRecording(false);
      console.error('마이크 접근 오류:', err);
      
      // 플랫폼별 구체적인 에러 메시지 제공
      const isMobile = typeof window !== 'undefined' ? /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) : false;
      const isIOS = typeof window !== 'undefined' ? /iPad|iPhone|iPod/.test(navigator.userAgent) : false;
      const isAndroid = typeof window !== 'undefined' ? /Android/.test(navigator.userAgent) : false;
      
      if (err?.name === 'NotAllowedError') {
        setMicState('denied');
        if (isMobile) {
          if (isIOS) {
            alert('🎤 마이크 권한이 거부되었습니다\n\n📱 iPhone/iPad 해결 방법:\n\n1️⃣ 설정 앱 열기\n2️⃣ Safari 선택\n3️⃣ 웹사이트 설정 → 마이크\n4️⃣ 이 사이트를 "허용"으로 변경\n5️⃣ Safari로 돌아가서 페이지 새로고침\n\n💡 팁: 권한 설정 후에도 문제가 있다면 Safari를 완전히 종료하고 다시 열어보세요');
          } else if (isAndroid) {
            alert('🎤 마이크 권한이 거부되었습니다\n\n🤖 Android 해결 방법:\n\n1️⃣ Chrome 주소창의 🔒 자물쇠 아이콘 클릭\n2️⃣ 마이크를 "허용"으로 변경\n3️⃣ 또는 Chrome 메뉴 → 설정 → 사이트 설정 → 마이크\n4️⃣ 페이지 새로고침 후 다시 시도\n\n💡 팁: 권한 설정 후에도 문제가 있다면 Chrome을 완전히 종료하고 다시 열어보세요');
          }
        } else {
          alert('🎤 마이크 권한이 거부되었습니다\n\n💻 PC 해결 방법:\n\n1️⃣ 브라우저 주소창 왼쪽의 🔒 자물쇠 아이콘 클릭\n2️⃣ 마이크 권한을 "허용"으로 변경\n3️⃣ 또는 시스템 환경설정 > 보안 및 개인 정보 보호 > 마이크에서 Chrome 허용\n4️⃣ 페이지 새로고침 후 다시 시도');
        }
      } else if (err?.name === 'NotFoundError') {
        setMicState('blocked');
        alert('마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인해주세요.');
      } else if (err?.name === 'NotReadableError') {
        setMicState('blocked');
        alert('마이크가 다른 애플리케이션에서 사용 중입니다. 다른 앱을 종료하고 다시 시도해주세요.');
      } else if (err?.name === 'OverconstrainedError') {
        setMicState('blocked');
        alert('마이크 설정이 지원되지 않습니다. 다른 브라우저를 시도해보세요.');
      } else {
        setMicState('blocked');
        const protocol = window.location.protocol;
        if (protocol !== 'https:' && window.location.hostname !== 'localhost') {
          alert('HTTPS 연결이 필요합니다. 보안상 마이크는 HTTPS에서만 사용할 수 있습니다.');
        } else {
          alert('마이크 접근에 실패했습니다. 브라우저를 새로고침하고 다시 시도해주세요.');
        }
      }
      return;
    }

    rec.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript: string = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTextRef.current += transcript;
        else interim += transcript;
      }
      setUserText(interim || finalTextRef.current);
    };

    rec.onend = () => {
      const elapsed = Date.now() - startTimeRef.current;
      if (elapsed < minDurationRef.current) {
        try { rec.start(); } catch {}
        return;
      }
      isRecognizingRef.current = false;
      setIsRecording(false);

      const finalText = finalTextRef.current.trim() || userText.trim();
      if (finalText) {
        setUserText(finalText);
        setAppState('transcribed');
        setTimeout(() => setAppState('analyzed'), 400);
      } else {
        setAppState('initial');
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
    };

    rec.onerror = () => { cleanupMedia(); setAppState('initial'); };

    try { rec.start(); isRecognizingRef.current = true; } catch {}
  };

  const handleAgain = async () => {
    cleanupMedia();
    await handleStartRecording();
  };

  // 분석 단계/말투 변경 시: 서버 교정 호출
  useEffect(() => {
    if (appState !== 'analyzed') return;
    const run = async () => {
      setAiLoading(true); setAiError(''); setAiText(''); setAiNotes([]);
      try {
        const res = await fetch('/api/correct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: userText, speechLevel }),
        });
        const data = await res.json();
        if (!res.ok || !data?.result) throw new Error(data?.error || 'AI correction failed');
        setAiText(data.result);
        setAiNotes(Array.isArray(data.notes) ? data.notes : []);
      } catch (e: any) {
        console.error('AI 교정 오류:', e);
        
        // OpenAI 할당량 초과 오류 처리
        if (e?.message?.includes('quota') || e?.message?.includes('insufficient_quota')) {
          setAiError('OpenAI API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.');
        } else {
          setAiError(e?.message || 'AI error');
        }
        
        // 최소한 클라이언트 룰 기반 노트 제공
        setAiNotes(ruleBasedNotes(userText));
        setAiText(userText);
      } finally { setAiLoading(false); }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState, speechLevel, userText]);

  const displayed = aiText;

  // TTS: 버튼 클릭 시에만 호출
// ✅ TTS: 버튼 클릭 시에만 호출 (서버 실패 시 브라우저 TTS 폴백 + UI에 에러 JSON 미노출)
const handleSpeak = async () => {
  const text = (displayed || '').trim(); // displayed: 화면에 보여줄 문장(현재 코드 그대로 사용)
  if (!text) return;

  try {
    setTtsLoading(true);

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }), // voice 상태 그대로 사용
    });

    if (!res.ok) {
      // ❗ 서버 에러 전문을 화면에 표시하지 않음
      console.warn('TTS server non-OK:', res.status);

      // 🔁 폴백: 브라우저 TTS(Web Speech Synthesis)
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        alert('Server TTS failed. Used browser TTS fallback.');
      } else {
        alert('TTS unavailable on this device.');
      }
      return;
    }

    // ✅ 서버 TTS 성공 → 오디오 재생
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    if (audioRef.current) {
      audioRef.current.src = url;
      try {
        await audioRef.current.play();
      } catch {
        // 오토플레이 정책 회피
        alert('Tap once more to allow audio playback.');
        await audioRef.current.play().catch(() => {});
      }
    } else {
      // audioRef가 없다면 임시 <audio>로 재생
      const audio = new Audio(url);
      try {
        await audio.play();
      } catch {
        alert('Tap once more to allow audio playback.');
        await audio.play().catch(() => {});
      }
    }
  } catch (e) {
    console.error('TTS client error:', e);

    // 🔁 폴백: 브라우저 TTS
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      alert('Server error. Used browser TTS fallback.');
    } else {
      alert('TTS unavailable.');
    }
  } finally {
    setTtsLoading(false);
  }
};


  /* ========================= UI ========================= */
  return (
    <div style={{
      minHeight: '100vh',
      margin: 0,
      padding: 0,
      overflowX: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1.5rem',
        paddingTop: '3rem'
      }}>
        <motion.h1 
          initial={{ opacity: 0, x: -20 }} 
          animate={{ opacity: 1, x: 0 }} 
          style={{
            fontSize: '1.25rem',
            fontWeight: 'bold',
            background: 'linear-gradient(to right, #db2777, #2563eb)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          Read Aloud Korean
        </motion.h1>
        <motion.div 
          initial={{ opacity: 0, x: 20 }} 
          animate={{ opacity: 1, x: 0 }} 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(4px)',
            borderRadius: '9999px',
            padding: '0.25rem 0.75rem',
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
          }}
        >
          <motion.div 
            style={{
              width: '0.5rem',
              height: '0.5rem',
              borderRadius: '50%',
              backgroundColor: micState === 'ok' ? '#10b981' : 
                              micState === 'denied' ? '#ef4444' : 
                              micState === 'blocked' ? '#f97316' : 
                              '#6b7280'
            }} 
            animate={{ scale: [1, 1.2, 1] }} 
            transition={{ duration: 1.5, repeat: Infinity }} 
          />
          <span style={{
            fontSize: '0.875rem',
            fontWeight: '500',
            color: micState === 'ok' ? '#047857' : 
                   micState === 'denied' ? '#b91c1c' : 
                   micState === 'blocked' ? '#c2410c' : 
                   '#374151'
          }}>
            MIC {
              micState === 'ok' ? 'on' : 
              micState === 'denied' ? 'denied' : 
              micState === 'blocked' ? 'blocked' : 
              micState === 'unsupported' ? 'unsupported' : 
              'unknown'
            }
          </span>
        </motion.div>
      </div>

      {/* Title */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        padding: '0 1.5rem 2rem 1.5rem'
      }}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ delay: 0.2 }} 
          style={{
            textAlign: 'center',
            marginBottom: '2.5rem'
          }}
        >
          <h2 style={{
            fontSize: '2.25rem',
            fontWeight: 'bold',
            marginBottom: '0.75rem',
            background: 'linear-gradient(to right, #db2777, #7c3aed, #2563eb)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}>
            Speak Aloud Korean
          </h2>
               <p style={{
                 color: '#4b5563',
                 fontSize: '1.125rem'
               }}>
                 괜찮아요, 무엇이든 말해보세요
               </p>
          <div style={{
            marginTop: '1rem',
            display: 'flex',
            justifyContent: 'center'
          }}>
            <div style={{
              display: 'flex',
              gap: '0.25rem'
            }}>
              <div style={{
                width: '0.5rem',
                height: '0.5rem',
                backgroundColor: '#f472b6',
                borderRadius: '50%'
              }}></div>
              <div style={{
                width: '0.5rem',
                height: '0.5rem',
                backgroundColor: '#c084fc',
                borderRadius: '50%'
              }}></div>
              <div style={{
                width: '0.5rem',
                height: '0.5rem',
                backgroundColor: '#60a5fa',
                borderRadius: '50%'
              }}></div>
            </div>
          </div>
        </motion.div>

        {/* Recorder + Buttons */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: '2.5rem'
        }}>
          <motion.div 
            style={{
              position: 'relative',
              width: '18rem',
              height: '14rem',
              marginBottom: '1.5rem'
            }}
            animate={isRecording ? { scale: [1, 1.08, 1.02, 1.08, 1], rotate: [0, 2, -2, 1, 0] } : {}} 
            transition={{ duration: 2, repeat: isRecording ? Infinity : 0 }}
          >
            {/* blob & mic visuals */}
            <svg 
              viewBox="0 0 260 200" 
              style={{
                width: '100%',
                height: '100%',
                filter: 'drop-shadow(0 25px 25px rgba(0, 0, 0, 0.15))'
              }} 
              fill="none" 
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="blobGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{ stopColor: isRecording ? '#FF6B9D' : '#E57373' }} />
                  <stop offset="50%" style={{ stopColor: isRecording ? '#C44569' : '#EC407A' }} />
                  <stop offset="100%" style={{ stopColor: isRecording ? '#F8B500' : '#E57373' }} />
                </linearGradient>
              </defs>
              <motion.path
                d="M60 80C20 60 10 100 30 140C50 180 120 190 180 170C240 150 250 110 230 70C210 30 160 20 120 40C80 60 100 100 60 80Z"
                fill="url(#blobGradient)"
                animate={
                  isRecording
                    ? {
                        d: [
                          'M60 80C20 60 10 100 30 140C50 180 120 190 180 170C240 150 250 110 230 70C210 30 160 20 120 40C80 60 100 100 60 80Z',
                          'M70 90C30 70 20 110 40 150C60 190 130 200 190 180C250 160 260 120 240 80C220 40 170 30 130 50C90 70 110 110 70 90Z',
                          'M60 80C20 60 10 100 30 140C50 180 120 190 180 170C240 150 250 110 230 70C210 30 160 20 120 40C80 60 100 100 60 80Z',
                        ],
                      }
                    : {}
                }
                transition={{ duration: 4, repeat: isRecording ? Infinity : 0, ease: 'easeInOut' }}
              />
            </svg>
            <div style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <motion.div 
                style={{
                  position: 'relative',
                  cursor: 'pointer'
                }}
                animate={isRecording ? { scale: [1, 1.3, 1.1, 1.3, 1], rotate: [0, -5, 5, -3, 0] } : {}} 
                transition={{ duration: 2, repeat: isRecording ? Infinity : 0 }}
                onClick={(e) => {
                  // 마이크가 차단되거나 거부된 상태에서는 클릭 무시
                  if (micState === 'denied' || micState === 'blocked') {
                    e.preventDefault();
                    return;
                  }
                  handleStartRecording();
                }}
                onTouchStart={(e) => {
                  // 마이크가 차단되거나 거부된 상태에서는 터치 피드백 없음
                  if (micState === 'denied' || micState === 'blocked') {
                    return;
                  }
                  // 모바일에서 터치 피드백 개선
                  e.currentTarget.style.transform = 'scale(0.95)';
                }}
                onTouchEnd={(e) => {
                  // 마이크가 차단되거나 거부된 상태에서는 터치 피드백 없음
                  if (micState === 'denied' || micState === 'blocked') {
                    return;
                  }
                  e.currentTarget.style.transform = '';
                }}
                style={{ WebkitTapHighlightColor: 'transparent' }}
                title="마이크를 클릭하여 녹음 시작"
              >
                <Mic 
                  style={{
                    position: 'relative',
                    width: '3.5rem',
                    height: '3.5rem',
                    color: '#ffffff',
                    filter: 'drop-shadow(0 10px 8px rgba(0, 0, 0, 0.04))',
                    transition: 'all 0.2s',
                    opacity: micState === 'denied' || micState === 'blocked' ? 0.5 : 1,
                    cursor: micState === 'denied' || micState === 'blocked' ? 'not-allowed' : 'pointer'
                  }}
                  strokeWidth={2.5} 
                />
                {/* 클릭 가능하다는 것을 나타내는 시각적 힌트 */}
                {!isRecording && micState !== 'denied' && micState !== 'blocked' && (
                  <motion.div
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      bottom: 0,
                      left: 0,
                      borderRadius: '50%',
                      border: '2px solid rgba(255, 255, 255, 0.3)'
                    }}
                    animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                )}
              </motion.div>
            </div>
          </motion.div>

          <motion.div 
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.75rem'
            }}
            animate={isRecording ? { y: [0, -5, 0] } : {}} 
            transition={{ duration: 2, repeat: isRecording ? Infinity : 0 }}
          >
            <div style={{ textAlign: 'center' }}>
              <span style={{
                fontSize: '1.25rem',
                fontWeight: '600'
              }}>
                {isRecording ? '🎤 Recording...' : 'Ready to record'}
              </span>
              {!isRecording && micState !== 'denied' && micState !== 'blocked' && (
                <p style={{
                  fontSize: '0.875rem',
                  color: '#4b5563',
                  marginTop: '0.25rem'
                }}>
                  마이크 아이콘을 클릭하거나 아래 버튼을 눌러주세요
                </p>
              )}
            </div>

            {/* 🔄 Again */}
            <button 
              onClick={handleAgain} 
              disabled={isRecording} 
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.875rem',
                color: '#2563eb',
                background: 'none',
                border: 'none',
                cursor: isRecording ? 'not-allowed' : 'pointer',
                padding: '0.5rem',
                borderRadius: '0.375rem',
                transition: 'color 0.2s',
                opacity: isRecording ? 0.5 : 1
              }}
              onMouseEnter={(e) => {
                if (!isRecording) e.currentTarget.style.color = '#1d4ed8';
              }}
              onMouseLeave={(e) => {
                if (!isRecording) e.currentTarget.style.color = '#2563eb';
              }}
              aria-label="Again" 
              title="Again"
            >
              <span>🔄 Again</span>
            </button>

            {!isRecording && appState === 'initial' && (
              <motion.div 
                initial={{ scale: 0 }} 
                animate={{ scale: 1 }} 
                transition={{ type: 'spring', delay: 0.2 }} 
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '1rem'
                }}
              >
                <button 
                  onClick={handleStartRecording} 
                  onTouchStart={(e) => {
                    // 모바일에서 터치 피드백 개선
                    e.currentTarget.style.transform = 'scale(0.95)';
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.transform = '';
                  }}
                  disabled={micState === 'denied' || micState === 'blocked'}
                  style={{
                    background: (micState === 'denied' || micState === 'blocked')
                      ? 'linear-gradient(to right, #9ca3af, #6b7280, #4b5563)'
                      : 'linear-gradient(to right, #ec4899, #ef4444, #f97316)',
                    color: '#ffffff',
                    padding: '0.75rem 2rem',
                    borderRadius: '9999px',
                    fontSize: '1.125rem',
                    fontWeight: '600',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    border: 'none',
                    cursor: (micState === 'denied' || micState === 'blocked') ? 'not-allowed' : 'pointer',
                    transform: 'scale(1)',
                    transition: 'all 0.2s',
                    WebkitTapHighlightColor: 'transparent',
                    touchAction: 'manipulation'
                  }}
                  onMouseEnter={(e) => {
                    if (micState !== 'denied' && micState !== 'blocked') {
                      e.currentTarget.style.background = 'linear-gradient(to right, #db2777, #dc2626, #ea580c)';
                      e.currentTarget.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.25)';
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (micState !== 'denied' && micState !== 'blocked') {
                      e.currentTarget.style.background = 'linear-gradient(to right, #ec4899, #ef4444, #f97316)';
                      e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)';
                      e.currentTarget.style.transform = 'scale(1)';
                    }
                  }}
                >
                  🚀 Let&apos;s Go!
                </button>
                
                {/* 마이크 권한 문제 안내 */}
                {(micState === 'denied' || micState === 'blocked') && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    style={{
                      background: 'linear-gradient(to bottom right, #fff7ed, #fef2f2)',
                      border: '2px solid #fb923c',
                      borderRadius: '0.75rem',
                      padding: '1.5rem',
                      maxWidth: '32rem',
                      textAlign: 'center',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
                    }}
                  >
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }}>🎤</div>
                      <p style={{
                        fontSize: '1.125rem',
                        fontWeight: 'bold',
                        color: '#9a3412',
                        marginBottom: '0.25rem'
                      }}>
                        마이크 권한이 필요해요
                      </p>
                      <p style={{
                        fontSize: '0.875rem',
                        color: '#c2410c'
                      }}>
                        아래 단계를 따라 권한을 허용해주세요
                      </p>
                    </div>
                    
                    <div style={{
                      fontSize: '0.875rem',
                      color: '#9a3412',
                      textAlign: 'left'
                    }}>
                      {(() => {
                        // 서버 사이드 렌더링에서 navigator 접근 방지
                        if (typeof window === 'undefined') {
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                <span style={{
                                  backgroundColor: '#fed7aa',
                                  color: '#9a3412',
                                  borderRadius: '50%',
                                  width: '1.25rem',
                                  height: '1.25rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '0.75rem',
                                  fontWeight: 'bold',
                                  flexShrink: 0,
                                  marginTop: '0.125rem'
                                }}>
                                  1
                                </span>
                                <p>브라우저 주소창의 <span style={{ fontWeight: '600' }}>🔒 자물쇠 아이콘</span> 클릭</p>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                <span style={{
                                  backgroundColor: '#fed7aa',
                                  color: '#9a3412',
                                  borderRadius: '50%',
                                  width: '1.25rem',
                                  height: '1.25rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '0.75rem',
                                  fontWeight: 'bold',
                                  flexShrink: 0,
                                  marginTop: '0.125rem'
                                }}>
                                  2
                                </span>
                                <p>마이크 권한을 <span style={{ fontWeight: '600', color: '#16a34a' }}>&quot;허용&quot;</span>으로 변경</p>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                <span style={{
                                  backgroundColor: '#fed7aa',
                                  color: '#9a3412',
                                  borderRadius: '50%',
                                  width: '1.25rem',
                                  height: '1.25rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '0.75rem',
                                  fontWeight: 'bold',
                                  flexShrink: 0,
                                  marginTop: '0.125rem'
                                }}>
                                  3
                                </span>
                                <p>페이지 새로고침 후 다시 시도</p>
                              </div>
                            </div>
                          );
                        }
                        
                        const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                        const isAndroid = /Android/.test(navigator.userAgent);
                        
                        if (isMobile) {
                          if (isIOS) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
                                  <p style={{ fontWeight: '600', color: '#9a3412' }}>📱 iPhone/iPad 사용자</p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <span style={{
                                    backgroundColor: '#fed7aa',
                                    color: '#9a3412',
                                    borderRadius: '50%',
                                    width: '1.25rem',
                                    height: '1.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                    marginTop: '0.125rem'
                                  }}>
                                    1
                                  </span>
                                  <p><span style={{ fontWeight: '600' }}>설정</span> 앱 열기</p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <span style={{
                                    backgroundColor: '#fed7aa',
                                    color: '#9a3412',
                                    borderRadius: '50%',
                                    width: '1.25rem',
                                    height: '1.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                    marginTop: '0.125rem'
                                  }}>
                                    2
                                  </span>
                                  <p><span style={{ fontWeight: '600' }}>Safari</span> 선택</p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <span style={{
                                    backgroundColor: '#fed7aa',
                                    color: '#9a3412',
                                    borderRadius: '50%',
                                    width: '1.25rem',
                                    height: '1.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                    marginTop: '0.125rem'
                                  }}>
                                    3
                                  </span>
                                  <p><span style={{ fontWeight: '600' }}>웹사이트 설정</span> → <span style={{ fontWeight: '600' }}>마이크</span></p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <span style={{
                                    backgroundColor: '#fed7aa',
                                    color: '#9a3412',
                                    borderRadius: '50%',
                                    width: '1.25rem',
                                    height: '1.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                    marginTop: '0.125rem'
                                  }}>
                                    4
                                  </span>
                                  <p>이 사이트를 <span style={{ fontWeight: '600', color: '#16a34a' }}>허용</span>으로 변경</p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <span style={{
                                    backgroundColor: '#fed7aa',
                                    color: '#9a3412',
                                    borderRadius: '50%',
                                    width: '1.25rem',
                                    height: '1.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                    marginTop: '0.125rem'
                                  }}>
                                    5
                                  </span>
                                  <p>Safari로 돌아가서 페이지 새로고침</p>
                                </div>
                              </div>
                            );
                          } else if (isAndroid) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
                                  <p style={{ fontWeight: '600', color: '#9a3412' }}>🤖 Android 사용자</p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <span style={{
                                    backgroundColor: '#fed7aa',
                                    color: '#9a3412',
                                    borderRadius: '50%',
                                    width: '1.25rem',
                                    height: '1.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                    marginTop: '0.125rem'
                                  }}>
                                    1
                                  </span>
                                  <p>Chrome 주소창의 <span style={{ fontWeight: '600' }}>🔒 자물쇠 아이콘</span> 클릭</p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <span style={{
                                    backgroundColor: '#fed7aa',
                                    color: '#9a3412',
                                    borderRadius: '50%',
                                    width: '1.25rem',
                                    height: '1.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                    marginTop: '0.125rem'
                                  }}>
                                    2
                                  </span>
                                  <p>마이크를 <span style={{ fontWeight: '600', color: '#16a34a' }}>허용</span>으로 변경</p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <span style={{
                                    backgroundColor: '#fed7aa',
                                    color: '#9a3412',
                                    borderRadius: '50%',
                                    width: '1.25rem',
                                    height: '1.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                    marginTop: '0.125rem'
                                  }}>
                                    3
                                  </span>
                                  <p>또는 Chrome 메뉴 → <span style={{ fontWeight: '600' }}>설정</span> → <span style={{ fontWeight: '600' }}>사이트 설정</span> → <span style={{ fontWeight: '600' }}>마이크</span></p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <span style={{
                                    backgroundColor: '#fed7aa',
                                    color: '#9a3412',
                                    borderRadius: '50%',
                                    width: '1.25rem',
                                    height: '1.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                    marginTop: '0.125rem'
                                  }}>
                                    4
                                  </span>
                                  <p>페이지 새로고침 후 다시 시도</p>
                                </div>
                              </div>
                            );
                          }
                        }
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                              <span style={{
                                backgroundColor: '#fed7aa',
                                color: '#9a3412',
                                borderRadius: '50%',
                                width: '1.25rem',
                                height: '1.25rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                flexShrink: 0,
                                marginTop: '0.125rem'
                              }}>
                                1
                              </span>
                              <p>브라우저 주소창의 <span style={{ fontWeight: '600' }}>🔒 자물쇠 아이콘</span> 클릭</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                              <span style={{
                                backgroundColor: '#fed7aa',
                                color: '#9a3412',
                                borderRadius: '50%',
                                width: '1.25rem',
                                height: '1.25rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                flexShrink: 0,
                                marginTop: '0.125rem'
                              }}>
                                2
                              </span>
                              <p>마이크 권한을 <span style={{ fontWeight: '600', color: '#16a34a' }}>&quot;허용&quot;</span>으로 변경</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                              <span style={{
                                backgroundColor: '#fed7aa',
                                color: '#9a3412',
                                borderRadius: '50%',
                                width: '1.25rem',
                                height: '1.25rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                flexShrink: 0,
                                marginTop: '0.125rem'
                              }}>
                                3
                              </span>
                              <p>페이지 새로고침 후 다시 시도</p>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    
                    <div style={{
                      marginTop: '1rem',
                      paddingTop: '0.75rem',
                      borderTop: '1px solid #fed7aa'
                    }}>
                      <p style={{
                        fontSize: '0.75rem',
                        color: '#c2410c',
                        marginBottom: '0.75rem'
                      }}>
                        💡 <strong>팁:</strong> 권한 설정 후에도 문제가 있다면 브라우저를 완전히 종료하고 다시 열어보세요
                      </p>
                      <button 
                        onClick={() => {
                          const isMobile = typeof window !== 'undefined' ? /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) : false;
                          const isIOS = typeof window !== 'undefined' ? /iPad|iPhone|iPod/.test(navigator.userAgent) : false;
                          const isAndroid = typeof window !== 'undefined' ? /Android/.test(navigator.userAgent) : false;
                          
                          if (isMobile) {
                            if (isIOS) {
                              alert('📱 iPhone/iPad 상세 가이드:\n\n1️⃣ iPhone/iPad의 "설정" 앱을 열어주세요\n2️⃣ "Safari"를 찾아서 탭하세요\n3️⃣ "웹사이트 설정"을 선택하세요\n4️⃣ "마이크"를 선택하세요\n5️⃣ 이 웹사이트를 "허용"으로 변경하세요\n6️⃣ Safari로 돌아가서 페이지를 새로고침하세요\n\n💡 여전히 안 된다면 Safari를 완전히 종료하고 다시 열어보세요');
                            } else if (isAndroid) {
                              alert('🤖 Android 상세 가이드:\n\n1️⃣ Chrome 주소창 왼쪽의 🔒 자물쇠 아이콘을 탭하세요\n2️⃣ "마이크" 항목을 찾아서 "허용"으로 변경하세요\n3️⃣ 또는 Chrome 메뉴(⋮) → 설정 → 사이트 설정 → 마이크\n4️⃣ 이 사이트를 "허용"으로 설정하세요\n5️⃣ 페이지를 새로고침하세요\n\n💡 여전히 안 된다면 Chrome을 완전히 종료하고 다시 열어보세요');
                            }
                          } else {
                            alert('💻 PC 상세 가이드:\n\n1️⃣ 브라우저 주소창 왼쪽의 🔒 자물쇠 아이콘을 클릭하세요\n2️⃣ "마이크" 항목을 찾아서 "허용"으로 변경하세요\n3️⃣ 또는 시스템 환경설정 → 보안 및 개인 정보 보호 → 마이크에서 Chrome 허용\n4️⃣ 페이지를 새로고침하세요\n\n💡 여전히 안 된다면 브라우저를 완전히 종료하고 다시 열어보세요');
                          }
                        }}
                        style={{
                          backgroundColor: '#f97316',
                          color: '#ffffff',
                          padding: '0.5rem 1rem',
                          borderRadius: '0.5rem',
                          fontSize: '0.875rem',
                          fontWeight: '500',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#ea580c'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f97316'}
                      >
                        📖 상세 가이드 보기
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </motion.div>
        </div>

        <AnimatePresence mode="wait">
          {(appState === 'transcribed' || appState === 'analyzed' || appState === 'practice' || appState === 'final') && (
            <motion.div 
              initial={{ opacity: 0, y: 30 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: -30 }} 
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2rem'
              }}
            >
              {userText && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }} 
                  animate={{ opacity: 1, y: 0 }} 
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem'
                  }}
                >
                  <div style={{
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}>
                    <p style={{
                      fontSize: '0.875rem',
                      fontWeight: '500',
                      color: '#4b5563'
                    }}>
                      이렇게 이해했어요
                    </p>
                    <motion.div 
                      initial={{ scale: 0.9 }} 
                      animate={{ scale: 1 }} 
                      style={{
                        background: 'linear-gradient(to bottom right, #eff6ff, #e0e7ff)',
                        border: '2px solid #93c5fd',
                        borderRadius: '1.5rem',
                        padding: '1.5rem',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
                      }}
                    >
                      <p style={{
                        fontSize: '1.125rem',
                        color: '#1e40af',
                        lineHeight: '1.625'
                      }}>
                        {userText}
                      </p>
                    </motion.div>
                  </div>
                </motion.div>
              )}

              {appState === 'analyzed' && (
                <motion.div 
                  initial={{ opacity: 0, y: 30 }} 
                  animate={{ opacity: 1, y: 0 }} 
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.5rem'
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <p style={{
                      fontSize: '1.25rem',
                      fontWeight: '600',
                      background: 'linear-gradient(to right, #9333ea, #db2777)',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent'
                    }}>
                      이렇게 말하면 더 자연스러워요!
                    </p>
                  </div>

                  {/* 말투 선택 */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '1rem',
                    marginBottom: '1rem'
                  }}>
                    <button 
                      onClick={() => setSpeechLevel('banmal')} 
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '9999px',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                        backgroundColor: speechLevel === 'banmal' ? '#ec4899' : '#e5e7eb',
                        color: speechLevel === 'banmal' ? '#ffffff' : '#374151',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      반말
                    </button>
                    <button 
                      onClick={() => setSpeechLevel('jondaetmal')} 
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '9999px',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                        backgroundColor: speechLevel === 'jondaetmal' ? '#ec4899' : '#e5e7eb',
                        color: speechLevel === 'jondaetmal' ? '#ffffff' : '#374151',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      존댓말
                    </button>
                  </div>

                  {/* 교정문 + 오류 설명 */}
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }} 
                    animate={{ scale: 1, opacity: 1 }} 
                    transition={{ delay: 0.2 }} 
                    style={{
                      position: 'relative',
                      background: 'linear-gradient(to bottom right, #faf5ff, #fdf2f8)',
                      border: '2px solid #c084fc',
                      borderRadius: '1.5rem',
                      padding: '1.5rem',
                      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                    }}
                  >
                    <p style={{
                      fontSize: '1.25rem',
                      color: '#6b21a8',
                      lineHeight: '1.625',
                      fontWeight: '500'
                    }}>
                      "{displayed}"
                      {aiLoading && <span style={{
                        marginLeft: '0.5rem',
                        fontSize: '0.875rem',
                        color: '#a855f7'
                      }}>…생각 중</span>}
                    </p>

                    {/* 오류 설명 (서버 notes 우선, 실패 시 클라 룰 기반) */}
                    {aiNotes.length > 0 && (
                      <ul style={{
                        marginTop: '0.75rem',
                        fontSize: '0.875rem',
                        color: '#7c3aed',
                        listStyleType: 'disc',
                        listStylePosition: 'inside',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem'
                      }}>
                        {aiNotes.map((n, i) => <li key={i}>{n}</li>)}
                      </ul>
                    )}

                    {aiError && <div style={{
                      marginTop: '0.5rem',
                      fontSize: '0.75rem',
                      color: '#ef4444'
                    }}>
                      교정 서버가 불안정해요. 임시로 입력 기반으로 표시했어요. ({aiError})
                    </div>}
                  </motion.div>

                  {/* 이렇게 읽어요: 버튼 누를 때만 TTS */}
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    transition={{ delay: 0.4 }} 
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '1rem',
                      paddingTop: '1rem'
                    }}
                  >
                    <p style={{
                      fontSize: '1.125rem',
                      fontWeight: '600',
                      color: '#374151'
                    }}>
                      이렇게 읽어요 👇
                    </p>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem'
                    }}>
                      <select 
                        value={voice} 
                        onChange={(e) => setVoice(e.target.value)} 
                        style={{
                          padding: '0.5rem 0.75rem',
                          borderRadius: '9999px',
                          backgroundColor: '#ffffff',
                          border: '1px solid #d1d5db',
                          fontSize: '0.875rem',
                          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                        }}
                        aria-label="TTS Voice"
                      >
                        <option value="alloy">성우: Alloy</option>
                        <option value="verse">성우: Verse</option>
                        <option value="aria">성우: Aria</option>
                        <option value="nexus">성우: Nexus</option>
                      </select>

                      <button 
                        onClick={handleSpeak} 
                        disabled={ttsLoading || !displayed} 
                        style={{
                          background: 'linear-gradient(to right, #14b8a6, #3b82f6, #8b5cf6)',
                          color: '#ffffff',
                          padding: '0.75rem 2.5rem',
                          borderRadius: '9999px',
                          fontSize: '1.125rem',
                          fontWeight: '600',
                          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                          border: 'none',
                          cursor: (ttsLoading || !displayed) ? 'not-allowed' : 'pointer',
                          transform: 'scale(1)',
                          transition: 'all 0.2s',
                          opacity: (ttsLoading || !displayed) ? 0.6 : 1
                        }}
                        onMouseEnter={(e) => {
                          if (!ttsLoading && displayed) {
                            e.currentTarget.style.background = 'linear-gradient(to right, #0d9488, #2563eb, #7c3aed)';
                            e.currentTarget.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.25)';
                            e.currentTarget.style.transform = 'scale(1.05)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!ttsLoading && displayed) {
                            e.currentTarget.style.background = 'linear-gradient(to right, #14b8a6, #3b82f6, #8b5cf6)';
                            e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)';
                            e.currentTarget.style.transform = 'scale(1)';
                          }
                        }}
                      >
                        {ttsLoading ? '🔊 준비 중…' : '🔊 교정문 읽어주기'}
                      </button>
                    </div>

                    <audio ref={audioRef} hidden />
                  </motion.div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
