# 🎤 Read Aloud Korean - 한국어 발음 연습 앱

AI 기반 한국어 발음 교정 및 연습을 위한 웹 애플리케이션입니다. 음성 인식, AI 문법 교정, TTS(Text-to-Speech) 기능을 제공합니다.

![Read Aloud Korean](https://img.shields.io/badge/Next.js-14.2.5-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/React-18.2.0-blue?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.2.2-blue?style=for-the-badge&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4.10-38B2AC?style=for-the-badge&logo=tailwind-css)

## ✨ 주요 기능

- 🎤 **음성 인식**: 마이크를 통한 실시간 한국어 음성 인식
- 🤖 **AI 문법 교정**: OpenAI API를 활용한 자연스러운 한국어 문법 교정
- 🔊 **TTS 음성 재생**: 교정된 문장을 자연스러운 음성으로 재생
- 📱 **모바일 최적화**: 반응형 디자인으로 모바일/태블릿 지원
- 🎨 **아름다운 UI**: Framer Motion을 활용한 부드러운 애니메이션
- 🗣️ **말투 선택**: 반말/존댓말 선택 가능

## 🚀 시작하기

### 필수 요구사항

- Node.js 18.18 이상
- npm, yarn, pnpm 또는 bun

### 설치 및 실행

1. **저장소 클론**
```bash
git clone https://github.com/bunz5911/read-aloud-korean.git
cd read-aloud-korean
```

2. **의존성 설치**
```bash
npm install
# 또는
yarn install
# 또는
pnpm install
```

3. **환경 변수 설정**
```bash
# .env.local 파일 생성
OPENAI_API_KEY=your_openai_api_key_here
```

4. **개발 서버 실행**
```bash
npm run dev
# 또는
yarn dev
# 또는
pnpm dev
```

5. **브라우저에서 확인**
   - [http://localhost:3000](http://localhost:3000)에서 앱 확인

## 🛠️ 기술 스택

- **Frontend**: Next.js 14.2.5 (App Router)
- **UI Framework**: React 18.2.0
- **Styling**: Tailwind CSS 3.4.10
- **Animation**: Framer Motion 11.0.0
- **Icons**: Lucide React 0.300.0
- **Language**: TypeScript 5.2.2
- **AI**: OpenAI API (GPT-4)

## 📁 프로젝트 구조

```
read-aloud-korean/
├── app/
│   ├── api/
│   │   ├── correct/          # AI 문법 교정 API
│   │   ├── tts/              # TTS 음성 생성 API
│   │   └── health/           # 헬스 체크 API
│   ├── globals.css           # 전역 스타일 (Tailwind CSS)
│   ├── layout.tsx            # 루트 레이아웃
│   └── page.tsx              # 메인 페이지
├── public/                   # 정적 파일
├── certificates/             # SSL 인증서 (HTTPS 개발용)
└── README.md
```

## 🎯 사용 방법

1. **마이크 권한 허용**: 브라우저에서 마이크 권한을 허용해주세요
2. **음성 녹음**: 마이크 아이콘을 클릭하거나 "Let's Go!" 버튼을 눌러 녹음을 시작하세요
3. **문법 교정**: AI가 자동으로 문법을 교정하고 자연스러운 표현으로 개선해드립니다
4. **음성 재생**: 교정된 문장을 다양한 성우의 목소리로 들어보세요

## 🔧 API 엔드포인트

- `POST /api/correct` - 한국어 문법 교정
- `POST /api/tts` - 텍스트를 음성으로 변환
- `GET /api/health` - 서버 상태 확인

## 🌐 배포

### Vercel (권장)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/bunz5911/read-aloud-korean)

1. Vercel 계정에 로그인
2. "New Project" 클릭
3. GitHub 저장소 연결
4. 환경 변수 설정 (`OPENAI_API_KEY`)
5. 배포 완료!

### 다른 플랫폼

- **Netlify**: `npm run build && npm run start`
- **Railway**: Dockerfile 지원
- **AWS/GCP/Azure**: Node.js 앱으로 배포

## 🔒 보안 및 개인정보

- 음성 데이터는 실시간 처리되며 저장되지 않습니다
- OpenAI API를 통한 텍스트 처리 시 개인정보 보호 정책을 준수합니다
- HTTPS 연결을 통한 안전한 데이터 전송

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 `LICENSE` 파일을 참조하세요.

## 📞 문의

프로젝트에 대한 문의사항이나 버그 리포트는 [Issues](https://github.com/bunz5911/read-aloud-korean/issues)를 통해 제출해주세요.

---

⭐ 이 프로젝트가 도움이 되었다면 Star를 눌러주세요!
