'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic } from 'lucide-react';

type AppState = 'initial' | 'recording' | 'transcribed' | 'analyzed' | 'practice' | 'final';
type MicState = 'ok' | 'denied' | 'blocked' | 'unsupported';
type SpeechLevel = 'banmal' | 'jondaetmal';

export default function Home() {
  // 상태 관리
  const [appState, setAppState] = useState<AppState>('initial');
  const [isRecording, setIsRecording] = useState(false);
  const [micState, setMicState] = useState<MicState>('ok');
  const [userText, setUserText] = useState('');
  const [correctedText, setCorrectedText] = useState('');
  const [displayed, setDisplayed] = useState('');
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [speechLevel, setSpeechLevel] = useState<SpeechLevel>('banmal');
  const [voice, setVoice] = useState('alloy');
  const [ttsLoading, setTtsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Refs
  const recognitionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // 마이크 권한 체크
  const checkMicPermission = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMicState('unsupported');
        return false;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      setMicState('ok');
      stream.getTracks().forEach(track => track.stop());
      return true;
      
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setMicState('denied');
      } else if (err.name === 'NotFoundError') {
        setMicState('blocked');
      } else {
        setMicState('blocked');
      }
      return false;
    }
  };

  // Speech Recognition 초기화
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Speech Recognition 지원 체크
    const hasSR = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    if (!hasSR) { 
      setMicState('unsupported'); 
      return; 
    }
    
    // Speech Recognition 설정
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'ko-KR';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    
    recognitionRef.current = rec;

    // 마이크 권한 체크
    checkMicPermission();

    return () => {
      try { 
        recognitionRef.current?.abort?.(); 
      } catch {}
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // 녹음 시작
  const handleStartRecording = async () => {
    if (micState !== 'ok') {
      alert('마이크 권한이 필요합니다. 브라우저 설정에서 마이크 권한을 허용해주세요.');
      return;
    }

    try {
      setIsRecording(true);
      setAppState('recording');
      setUserText('');
      setCorrectedText('');
      setDisplayed('');
      setAiNotes([]);
      setAiError(null);

      // 마이크 스트림 시작
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      mediaStreamRef.current = stream;

      // Speech Recognition 시작
      if (recognitionRef.current) {
        recognitionRef.current.onstart = () => {
          console.log('녹음 시작');
        };

        recognitionRef.current.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setUserText(transcript);
          setAppState('transcribed');
          setIsRecording(false);
          
          // AI 교정 요청
          handleCorrection(transcript);
        };

        recognitionRef.current.onerror = (event: any) => {
          console.error('Speech Recognition 오류:', event.error);
          setIsRecording(false);
          setAppState('initial');
        };

        recognitionRef.current.onend = () => {
          setIsRecording(false);
        };

        recognitionRef.current.start();
      }
    } catch (error) {
      console.error('녹음 시작 오류:', error);
      setIsRecording(false);
      setAppState('initial');
    }
  };

  // AI 교정 요청
  const handleCorrection = async (text: string) => {
    setAiLoading(true);
    setAiError(null);

    try {
      const response = await fetch('/api/correct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          level: speechLevel
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setCorrectedText(data.corrected);
      setDisplayed(data.corrected);
      setAiNotes(data.notes || []);
      setAppState('analyzed');
    } catch (error) {
      console.error('AI 교정 오류:', error);
      setAiError(error instanceof Error ? error.message : 'Unknown error');
      // 임시로 입력 텍스트 표시
      setCorrectedText(text);
      setDisplayed(text);
      setAppState('analyzed');
    } finally {
      setAiLoading(false);
    }
  };

  // TTS 재생
  const handleSpeak = async () => {
    if (!displayed) return;

    setTtsLoading(true);
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: displayed,
          voice: voice
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        audioRef.current.play();
      }
    } catch (error) {
      console.error('TTS 오류:', error);
      alert('음성 재생에 실패했습니다.');
    } finally {
      setTtsLoading(false);
    }
  };

  // 다시 시작
  const handleAgain = () => {
    setAppState('initial');
    setUserText('');
    setCorrectedText('');
    setDisplayed('');
    setAiNotes([]);
    setAiError(null);
    setIsRecording(false);
  };

  return (
    <div style={{
      minHeight: '100vh',
      margin: 0,
      padding: 0,
      overflowX: 'hidden',
      background: 'linear-gradient(135deg, #fdf2f8 0%, #ffffff 50%, #eff6ff 100%)',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      WebkitTextSizeAdjust: '100%',
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
      WebkitTapHighlightColor: 'transparent',
      WebkitTouchCallout: 'none',
      WebkitUserSelect: 'none',
      MozUserSelect: 'none',
      msUserSelect: 'none',
      userSelect: 'none'
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
      </div>

      {/* Microphone Icon */}
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
              onClick={handleStartRecording}
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.95)';
              }}
              onTouchEnd={(e) => {
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
      </div>

      {/* Buttons */}
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

        {/* Again Button */}
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
          </motion.div>
        )}
      </motion.div>

      {/* Permission Guide */}
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
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            margin: '2rem auto'
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
          </div>
        </motion.div>
      )}

      {/* Results */}
      <AnimatePresence>
        {(appState === 'transcribed' || appState === 'analyzed' || appState === 'practice' || appState === 'final') && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '2rem',
              padding: '0 1.5rem 2rem 1.5rem'
            }}
          >
            {/* User Text */}
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

            {/* Correction Result */}
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

                {/* Speech Level Selection */}
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

                {/* Corrected Text */}
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

                  {/* AI Notes */}
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
              </motion.div>
            )}

            {/* TTS Section */}
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
      </AnimatePresence>
    </div>
  );
}