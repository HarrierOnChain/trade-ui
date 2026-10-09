import React, { useId } from "react";

function SolanaMark({ s = 12 }: { s?: number }) {
  const gradId = useId().replace(/:/g, "");
  return (
    // viewBox padded ~12% on each side so the SOL marks render at the same
    // visual weight as the 16x16 icons above (which carry built-in whitespace).
    <svg width={s} height={s} viewBox="-12 -12 125 112" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M100.48 69.3817L83.8068 86.8015C83.4444 87.1799 83.0058 87.4816 82.5185 87.6878C82.0312 87.894 81.5055 88.0003 80.9743 88H1.93563C1.55849 88 1.18957 87.8926 0.874202 87.6912C0.558829 87.4897 0.31074 87.2029 0.160416 86.8659C0.0100923 86.529 -0.0359181 86.1566 0.0280382 85.7945C0.0919944 85.4324 0.263131 85.0964 0.520422 84.8278L17.2061 67.408C17.5676 67.0306 18.0047 66.7295 18.4904 66.5234C18.9762 66.3172 19.5002 66.2104 20.0301 66.2095H99.0644C99.4415 66.2095 99.8104 66.3169 100.126 66.5183C100.441 66.7198 100.689 67.0067 100.84 67.3436C100.99 67.6806 101.036 68.0529 100.972 68.415C100.908 68.7771 100.737 69.1131 100.48 69.3817ZM83.8068 34.3032C83.4444 33.9248 83.0058 33.6231 82.5185 33.4169C82.0312 33.2108 81.5055 33.1045 80.9743 33.1048H1.93563C1.55849 33.1048 1.18957 33.2121 0.874202 33.4136C0.558829 33.6151 0.31074 33.9019 0.160416 34.2388C0.0100923 34.5758 -0.0359181 34.9482 0.0280382 35.3103C0.0919944 35.6723 0.263131 36.0083 0.520422 36.277L17.2061 53.6968C17.5676 54.0742 18.0047 54.3752 18.4904 54.5814C18.9762 54.7875 19.5002 54.8944 20.0301 54.8952H99.0644C99.4415 54.8952 99.8104 54.7879 100.126 54.5864C100.441 54.3849 100.689 54.0981 100.84 53.7612C100.99 53.4242 101.036 53.0518 100.972 52.6897C100.908 52.3277 100.737 51.9917 100.48 51.723L83.8068 34.3032ZM1.93563 21.7905H80.9743C81.5055 21.7907 82.0312 21.6845 82.5185 21.4783C83.0058 21.2721 83.4444 20.9704 83.8068 20.592L100.48 3.17219C100.737 2.90357 100.908 2.56758 100.972 2.2055C101.036 1.84342 100.99 1.47103 100.84 1.13408C100.689 0.79713 100.441 0.510296 100.126 0.308823C99.8104 0.107349 99.4415 1.24074e-05 99.0644 0L20.0301 0C19.5002 0.000878397 18.9762 0.107699 18.4904 0.313848C18.0047 0.519998 17.5676 0.821087 17.2061 1.19848L0.524723 18.6183C0.267681 18.8866 0.0966198 19.2223 0.0325185 19.5839C-0.0315829 19.9456 0.0140624 20.3177 0.163856 20.6545C0.31365 20.9913 0.561081 21.2781 0.875804 21.4799C1.19053 21.6817 1.55886 21.7896 1.93563 21.7905Z" fill={`url(#${gradId})`} />
      <defs>
        <linearGradient id={gradId} x1="8.52558" y1="90.0973" x2="88.9933" y2="-3.01622" gradientUnits="userSpaceOnUse">
          <stop offset="0.08" stopColor="#9945FF" />
          <stop offset="0.3" stopColor="#8752F3" />
          <stop offset="0.5" stopColor="#5497D5" />
          <stop offset="0.6" stopColor="#43B4CA" />
          <stop offset="0.72" stopColor="#28E0B9" />
          <stop offset="0.97" stopColor="#19FB9B" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export const Icon = {
  lock: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="10.5" r="0.9" fill="currentColor" />
    </svg>
  ),
  unlock: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="10.5" r="0.9" fill="currentColor" />
    </svg>
  ),
  key: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="5" cy="10.5" r="2.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="m7 8.5 6-6M11 4.5l1.6 1.6M9.4 6.1l1.2 1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  shield: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.8 13 3.6v4c0 3.1-2.1 5.4-5 6.6-2.9-1.2-5-3.5-5-6.6v-4L8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="m5.8 8 1.6 1.6L10.4 6.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  send: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14 2 7 9M14 2l-4.5 12L7 9 2 6.5 14 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  plus: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  trash: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  search: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  bolt: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
      <path d="M9 1 3 9h4l-1 6 6-8H8l1-6z" />
    </svg>
  ),
  bell: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M4 6a4 4 0 1 1 8 0v3l1 2H3l1-2V6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  wallet: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="4.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M11 9h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M2 5 10 2l1 2.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  phantom: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
      <path
        fill="#9179EA"
        d="M12 3a9 9 0 0 0-9 9v7.2c0 .55.7.8 1.05.37l1.4-1.74a.7.7 0 0 1 1.12.04l1.2 1.73a.7.7 0 0 0 1.16 0l1.2-1.73a.7.7 0 0 1 1.12-.04l1.2 1.73a.7.7 0 0 0 1.16 0l1.2-1.73a.7.7 0 0 1 1.12-.04l1.4 1.74c.35.43 1.05.18 1.05-.37V12a9 9 0 0 0-9-9Z"
      />
      <circle cx="9" cy="11" r="1.6" fill="#fff" />
      <circle cx="15" cy="11" r="1.6" fill="#fff" />
    </svg>
  ),
  gear: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1v2m0 10v2M1 8h2m10 0h2M3 3l1.5 1.5M11.5 11.5 13 13M3 13l1.5-1.5M11.5 4.5 13 3"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"
      />
    </svg>
  ),
  // Remix Icon `ri-settings-3-line` — ticker settings.
  settings3: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M8.68627 4.00008L11.293 1.39335C11.6835 1.00282 12.3167 1.00282 12.7072 1.39335L15.3139 4.00008H19.0001C19.5524 4.00008 20.0001 4.4478 20.0001 5.00008V8.68626L22.6068 11.293C22.9973 11.6835 22.9973 12.3167 22.6068 12.7072L20.0001 15.3139V19.0001C20.0001 19.5524 19.5524 20.0001 19.0001 20.0001H15.3139L12.7072 22.6068C12.3167 22.9973 11.6835 22.9973 11.293 22.6068L8.68627 20.0001H5.00008C4.4478 20.0001 4.00008 19.5524 4.00008 19.0001V15.3139L1.39335 12.7072C1.00282 12.3167 1.00282 11.6835 1.39335 11.293L4.00008 8.68626V5.00008C4.00008 4.4478 4.4478 4.00008 5.00008 4.00008H8.68627ZM6.00008 6.00008V9.5148L3.5148 12.0001L6.00008 14.4853V18.0001H9.5148L12.0001 20.4853L14.4853 18.0001H18.0001V14.4853L20.4853 12.0001L18.0001 9.5148V6.00008H14.4853L12.0001 3.5148L9.5148 6.00008H6.00008ZM12.0001 16.0001C9.79094 16.0001 8.00008 14.2092 8.00008 12.0001C8.00008 9.79094 9.79094 8.00008 12.0001 8.00008C14.2092 8.00008 16.0001 9.79094 16.0001 12.0001C16.0001 14.2092 14.2092 16.0001 12.0001 16.0001ZM12.0001 14.0001C13.1047 14.0001 14.0001 13.1047 14.0001 12.0001C14.0001 10.8955 13.1047 10.0001 12.0001 10.0001C10.8955 10.0001 10.0001 10.8955 10.0001 12.0001C10.0001 13.1047 10.8955 14.0001 12.0001 14.0001Z" />
    </svg>
  ),
  // Remix Icon `ri-layout-top-line` — toggle the top ticker bar.
  layoutTop: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M20 3C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3H20ZM19 9H5V19H19V9ZM19 5H5V7H19V5Z" />
    </svg>
  ),
  // Remix Icon `ri-star-line` — watchlist.
  starLine: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M12 .5l3.09 6.26L22 7.77l-5 4.87 1.18 6.88L12 16.26l-6.18 3.25L7 12.64 2 7.77l6.91-1.01L12 .5zm0 4.53L9.94 9.2l-4.6.67 3.33 3.24-.79 4.58L12 15.53l4.12 2.16-.79-4.58 3.33-3.24-4.6-.67L12 5.03z" />
    </svg>
  ),
  // Remix Icon `ri-line-chart-line` — active positions.
  lineChart: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M5 3V19H21V21H3V3H5ZM20.2929 6.29289L21.7071 7.70711L16 13.4142L13 10.415L8.70711 14.7071L7.29289 13.2929L13 7.58579L16 10.585L20.2929 6.29289Z" />
    </svg>
  ),
  // Remix Icon `ri-history-line` — recent pairs.
  history: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12H4C4 16.4183 7.58172 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C9.25022 4 6.82447 5.38734 5.38451 7.50024L8 7.5V9.5H2V3.5H4L3.99989 5.99918C5.82434 3.57075 8.72873 2 12 2ZM13 7V11.5858L16.2426 14.8284L14.8284 16.2426L11 12.415V7H13Z" />
    </svg>
  ),
  // Ionicon `rocket-outline` (hand-drawn equivalent) — deployed tokens.
  rocket: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M12 2.5c2.4 2 3.9 5 3.9 8.2 0 1.9-.5 3.4-1 4.4H9.1c-.5-1-1-2.5-1-4.4C8.1 7.5 9.6 4.5 12 2.5Z" />
      <circle cx="12" cy="9.3" r="1.5" />
      <path d="M8.2 13.8c-1.6.5-2.6 2-2.7 4.1 1.6-.1 2.6-.6 3.2-1.6M15.8 13.8c1.6.5 2.6 2 2.7 4.1-1.6-.1-2.6-.6-3.2-1.6M10.4 18.6c.3 1.1.8 2.1 1.6 2.9.8-.8 1.3-1.8 1.6-2.9" />
    </svg>
  ),
  // Remix Icon `ri-notification-3-line` — notifications.
  notification: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M20 17H22V19H2V17H4V10C4 5.58172 7.58172 2 12 2C16.4183 2 20 5.58172 20 10V17ZM18 17V10C18 6.68629 15.3137 4 12 4C8.68629 4 6 6.68629 6 10V17H18ZM9 21H15V23H9V21Z" />
    </svg>
  ),
  // Remix Icon `ri-article-line` — docs.
  article: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M20 22H4C3.44772 22 3 21.5523 3 21V3C3 2.44772 3.44772 2 4 2H20C20.5523 2 21 2.44772 21 3V21C21 21.5523 20.5523 22 20 22ZM19 20V4H5V20H19ZM7 6H12V11H7V6ZM7 13H17V15H7V13ZM7 16H17V18H7V16ZM14 7H17V9H14V7Z" />
    </svg>
  ),
  // Remix Icon `ri-palette-line` — theme / customize.
  palette: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M12 2C17.5228 2 22 5.97778 22 10.8889C22 13.9556 19.5111 16.4444 16.4444 16.4444H14.4778C13.5556 16.4444 12.8111 17.1889 12.8111 18.1111C12.8111 18.5333 12.9778 18.9222 13.2333 19.2333C13.5 19.5556 13.6667 19.9556 13.6667 20.3889C13.6667 21.2778 12.9111 22 12 22C6.47778 22 2 17.5222 2 12C2 6.47778 6.47778 2 12 2ZM10.8111 18.1111C10.8111 16.0843 12.451 14.4444 14.4778 14.4444H16.4444C18.4065 14.4444 20 12.851 20 10.8889C20 7.1392 16.4677 4 12 4C7.58172 4 4 7.58172 4 12C4 16.19 7.2226 19.6285 11.3234 19.9718C10.9947 19.4168 10.8111 18.7761 10.8111 18.1111ZM7.5 12C6.67157 12 6 11.3284 6 10.5C6 9.67157 6.67157 9 7.5 9C8.32843 9 9 9.67157 9 10.5C9 11.3284 8.32843 12 7.5 12ZM16.5 12C15.6716 12 15 11.3284 15 10.5C15 9.67157 15.6716 9 16.5 9C17.3284 9 18 9.67157 18 10.5C18 11.3284 17.3284 12 16.5 12ZM11.5 8C10.6716 8 10 7.32843 10 6.5C10 5.67157 10.6716 5 11.5 5C12.3284 5 13 5.67157 13 6.5C13 7.32843 12.3284 8 11.5 8Z" />
    </svg>
  ),
  // Remix Icon `ri-user-settings-line` — account settings.
  userSettings: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M12 14V16C8.68629 16 6 18.6863 6 22H4C4 17.5817 7.58172 14 12 14ZM12 13C8.685 13 6 10.315 6 7C6 3.685 8.685 1 12 1C15.315 1 18 3.685 18 7C18 10.315 15.315 13 12 13ZM12 11C14.21 11 16 9.21 16 7C16 4.79 14.21 3 12 3C9.79 3 8 4.79 8 7C8 9.21 9.79 11 12 11ZM14.5946 18.8115C14.5327 18.5511 14.5 18.2794 14.5 18C14.5 17.7207 14.5327 17.449 14.5945 17.1886L13.6029 16.6161L14.6029 14.8841L15.5952 15.4569C15.9883 15.0851 16.4676 14.8034 17 14.6449V13.5H19V14.6449C19.5324 14.8034 20.0116 15.0851 20.4047 15.4569L21.3971 14.8841L22.3971 16.6161L21.4055 17.1885C21.4673 17.449 21.5 17.7207 21.5 18C21.5 18.2793 21.4673 18.551 21.4055 18.8114L22.3971 19.3839L21.3971 21.1159L20.4048 20.5431C20.0117 20.9149 19.5324 21.1966 19 21.3551V22.5H17V21.3551C16.4676 21.1966 15.9884 20.9149 15.5953 20.5431L14.6029 21.1159L13.6029 19.3839L14.5946 18.8115ZM18 19.5C18.8284 19.5 19.5 18.8284 19.5 18C19.5 17.1716 18.8284 16.5 18 16.5C17.1716 16.5 16.5 17.1716 16.5 18C16.5 18.8284 17.1716 19.5 18 19.5Z" />
    </svg>
  ),
  chart: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M2 13V3M2 13h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5 10V7M8 10V5M11 10V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  volume: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M2.5 12.5v-4M6 12.5v-7M9.5 12.5v-5M13 12.5V3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  speaker: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M2 6.25h2.4L8 3.4v9.2L4.4 9.75H2a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5Z" fill="currentColor" />
      <path d="M10.4 5.6c.7.6 1.1 1.45 1.1 2.4s-.4 1.8-1.1 2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d="M12.5 3.7c1.25 1.05 2 2.6 2 4.3s-.75 3.25-2 4.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  ),
  trades: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M2.5 5.5h8.5M8.5 2.5l3 3-3 3M13.5 10.5H5M7.5 7.5l-3 3 3 3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  holders: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="5.25" cy="5.25" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10.9" cy="5.7" r="1.45" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.8 12.3a2.8 2.8 0 0 1 4.9-1.8 2.8 2.8 0 0 1 4.9 1.8M9.2 11.85c.2-1.2.95-1.95 2.15-2.2 1.1.18 1.87.82 2.25 1.95" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  fees: (s = 12) => <SolanaMark s={s} />,
  solana: (s = 12) => <SolanaMark s={s} />,
  bitcoin: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M6.05 3.25v1.25M7.55 3.25v1.25M6.05 11.5v1.25M7.55 11.5v1.25" stroke="var(--ink-0)" strokeWidth="0.85" strokeLinecap="round" />
      <path
        d="M5.35 4.55h3.15c1.35 0 2.15.62 2.15 1.65 0 .73-.4 1.25-1.06 1.48.82.2 1.31.77 1.31 1.68 0 1.23-.93 2.09-2.44 2.09H5.35V4.55Zm1.43 1.13v1.55h1.43c.66 0 1.02-.29 1.02-.79 0-.49-.36-.76-1.02-.76H6.78Zm0 2.63v1.99h1.58c.72 0 1.1-.36 1.1-1 0-.63-.39-.99-1.12-.99H6.78Z"
        fill="var(--ink-0)"
      />
    </svg>
  ),
  ethereum: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M8 1.3 3.55 8.05 8 10.65l4.45-2.6L8 1.3Z" fill="currentColor" />
      <path d="M8 14.7 3.55 8.9 8 11.5l4.45-2.6L8 14.7Z" fill="currentColor" opacity="0.68" />
      <path d="M8 1.3v9.35M3.55 8.05 8 6.05l4.45 2" stroke="var(--ink-0)" strokeOpacity="0.45" strokeWidth="0.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  dev: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="8" cy="4.6" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.4 14a5.6 5.6 0 0 1 11.2 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  crown: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M2.2 5.1a.7.7 0 0 1 1.05-.61L5.7 5.9 7.42 3.2a.7.7 0 0 1 1.16 0L10.3 5.9l2.45-1.4a.7.7 0 0 1 1.05.61l-.42 5.34a1.1 1.1 0 0 1-1.1 1.01H3.72a1.1 1.1 0 0 1-1.1-1.01l-.42-5.34Zm1.7 7.95h8.2a.55.55 0 1 1 0 1.1H3.9a.55.55 0 1 1 0-1.1Z" />
    </svg>
  ),
  pro: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M8 2.2 10.1 6l4.1.8-2.8 3.1.5 4.1L8 12.25 4.1 14l.5-4.1-2.8-3.1L5.9 6 8 2.2Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M6.3 8.45h3.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  ),
  portfolio: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M2 6h12v7H2z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 6V4h6v2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  deploy: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M8 2v9M4.5 5.5 8 2l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 13h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  migrate: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M2 8h11M10 4.5 13.5 8 10 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  trend: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M2 11 6 7l3 3 5-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 4h4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  close: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16">
      <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  check: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="m3 8 3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  copy: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <rect x="4.5" y="4.5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 11.5V3a.5.5 0 0 1 .5-.5H11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  ext: (s = 10) => (
    <svg width={s} height={s} viewBox="0 0 12 12">
      <path d="M4 2h6v6M10 2 4 8M4 6v4H2V4h4" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  ),
  // Remix Icon `ri-twitter-x-fill`.
  x: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m17.687 3.063l-4.996 5.711l-4.32-5.711H2.112l7.477 9.776l-7.086 8.099h3.034l5.469-6.25l4.78 6.25h6.102l-7.794-10.304l6.625-7.571zm-1.064 16.06L5.654 4.782h1.803l10.846 14.34z" />
    </svg>
  ),
  // Profile icon = bare X mark (alias of `x`, kept for clarity at call site).
  xProfile: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m17.687 3.063l-4.996 5.711l-4.32-5.711H2.112l7.477 9.776l-7.086 8.099h3.034l5.469-6.25l4.78 6.25h6.102l-7.794-10.304l6.625-7.571zm-1.064 16.06L5.654 4.782h1.803l10.846 14.34z" />
    </svg>
  ),
  // Tweet icon = X mark inside a speech bubble. Drawn so the X reads at
  // 12px without becoming a blob — the bubble is a rounded square with a
  // tail, knocked out with a fill-rule trick to leave the X transparent.
  xTweet: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.5 3a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 3.5 17H7v3.4a.6.6 0 0 0 1 .45L12.6 17h7.9a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 20.5 3h-17Zm5.34 3.2 2.62 3.6 3.04-3.6h1.79l-3.96 4.66 4.43 5.94h-3.7l-2.9-3.99-3.36 3.99H5.01l4.16-4.92L5 6.2h3.84Zm5.59 9.6h1l-6.95-9.32H7.45l6.98 9.32Z"
      />
    </svg>
  ),
  // Remix Icon `ri-telegram-2-fill`.
  telegram: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2.148 11.81q7.87-3.429 10.497-4.522c4.999-2.079 6.037-2.44 6.714-2.452c.15-.003.482.034.698.21c.182.147.232.347.256.487s.054.459.03.708c-.27 2.847-1.443 9.754-2.04 12.942c-.252 1.348-.748 1.8-1.23 1.845c-1.045.096-1.838-.69-2.85-1.354c-1.585-1.039-2.48-1.686-4.018-2.699c-1.777-1.171-.625-1.815.388-2.867c.265-.275 4.87-4.464 4.96-4.844c.01-.048.021-.225-.084-.318c-.105-.094-.26-.062-.373-.036q-.239.054-7.592 5.018q-1.079.74-1.952.721c-.643-.014-1.88-.363-2.798-.662c-1.128-.367-2.024-.56-1.946-1.183q.061-.486 1.34-.994" />
    </svg>
  ),
  // Remix Icon `ri-global-line` — generic/unknown website fallback.
  website: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10m-2.29-2.333A17.9 17.9 0 0 1 8.027 13H4.062a8.01 8.01 0 0 0 5.648 6.667M10.03 13c.151 2.439.848 4.73 1.97 6.752A15.9 15.9 0 0 0 13.97 13zm9.908 0h-3.965a17.9 17.9 0 0 1-1.683 6.667A8.01 8.01 0 0 0 19.938 13M4.062 11h3.965A17.9 17.9 0 0 1 9.71 4.333A8.01 8.01 0 0 0 4.062 11m5.969 0h3.938A15.9 15.9 0 0 0 12 4.248A15.9 15.9 0 0 0 10.03 11m4.259-6.667A17.9 17.9 0 0 1 15.973 11h3.965a8.01 8.01 0 0 0-5.648-6.667" />
    </svg>
  ),
  // Remix Icon `ri-github-fill`.
  github: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.001 2c-5.525 0-10 4.475-10 10a9.99 9.99 0 0 0 6.837 9.488c.5.087.688-.213.688-.476c0-.237-.013-1.024-.013-1.862c-2.512.463-3.162-.612-3.362-1.175c-.113-.288-.6-1.175-1.025-1.413c-.35-.187-.85-.65-.013-.662c.788-.013 1.35.725 1.538 1.025c.9 1.512 2.337 1.087 2.912.825c.088-.65.35-1.087.638-1.337c-2.225-.25-4.55-1.113-4.55-4.938c0-1.088.387-1.987 1.025-2.687c-.1-.25-.45-1.275.1-2.65c0 0 .837-.263 2.75 1.024a9.3 9.3 0 0 1 2.5-.337c.85 0 1.7.112 2.5.337c1.913-1.3 2.75-1.024 2.75-1.024c.55 1.375.2 2.4.1 2.65c.637.7 1.025 1.587 1.025 2.687c0 3.838-2.337 4.688-4.562 4.938c.362.312.675.912.675 1.85c0 1.337-.013 2.412-.013 2.75c0 .262.188.574.688.474A10.02 10.02 0 0 0 22 12c0-5.525-4.475-10-10-10" />
    </svg>
  ),
  // Remix Icon `ri-instagram-fill`.
  instagram: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.028 2c1.125.003 1.696.009 2.189.023l.194.007c.224.008.445.018.712.03c1.064.05 1.79.218 2.427.465c.66.254 1.216.598 1.772 1.153a4.9 4.9 0 0 1 1.153 1.772c.247.637.415 1.363.465 2.428c.012.266.022.487.03.712l.006.194c.015.492.021 1.063.023 2.188l.001.746v1.31a79 79 0 0 1-.023 2.188l-.006.194c-.008.225-.018.446-.03.712c-.05 1.065-.22 1.79-.466 2.428a4.9 4.9 0 0 1-1.153 1.772a4.9 4.9 0 0 1-1.772 1.153c-.637.247-1.363.415-2.427.465l-.712.03l-.194.006c-.493.014-1.064.021-2.189.023l-.746.001h-1.309a78 78 0 0 1-2.189-.023l-.194-.006a63 63 0 0 1-.712-.031c-1.064-.05-1.79-.218-2.428-.465a4.9 4.9 0 0 1-1.771-1.153a4.9 4.9 0 0 1-1.154-1.772c-.247-.637-.415-1.363-.465-2.428l-.03-.712l-.005-.194A79 79 0 0 1 2 13.028v-2.056a79 79 0 0 1 .022-2.188l.007-.194c.008-.225.018-.446.03-.712c.05-1.065.218-1.79.465-2.428A4.9 4.9 0 0 1 3.68 3.678a4.9 4.9 0 0 1 1.77-1.153c.638-.247 1.363-.415 2.428-.465c.266-.012.488-.022.712-.03l.194-.006a79 79 0 0 1 2.188-.023zM12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10m0 2a3 3 0 1 1 .001 6a3 3 0 0 1 0-6m5.25-3.5a1.25 1.25 0 0 0 0 2.5a1.25 1.25 0 0 0 0-2.5" />
    </svg>
  ),
  // Remix Icon `ri-facebook-circle-fill`.
  facebook: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.001 2c-5.523 0-10 4.477-10 10c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89c1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.344 21.129 22 16.992 22 12c0-5.523-4.477-10-10-10" />
    </svg>
  ),
  // Remix Icon `ri-youtube-fill`.
  youtube: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.244 4c.534.003 1.87.016 3.29.073l.504.022c1.429.067 2.857.183 3.566.38c.945.266 1.687 1.04 1.938 2.022c.4 1.56.45 4.602.456 5.339l.001.152v.174c-.007.737-.057 3.78-.457 5.339c-.254.985-.997 1.76-1.938 2.022c-.709.197-2.137.313-3.566.38l-.504.023c-1.42.056-2.756.07-3.29.072l-.235.001h-.255c-1.13-.007-5.856-.058-7.36-.476c-.944-.266-1.687-1.04-1.938-2.022c-.4-1.56-.45-4.602-.456-5.339v-.326c.006-.737.056-3.78.456-5.339c.254-.985.997-1.76 1.939-2.021c1.503-.419 6.23-.47 7.36-.476zM9.999 8.5v7l6-3.5z" />
    </svg>
  ),
  // Remix Icon `ri-tiktok-fill`.
  tiktok: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16 8.245V15.5a6.5 6.5 0 1 1-5-6.326v3.163a3.5 3.5 0 1 0 2 3.163V2h3a5 5 0 0 0 5 5v3a7.97 7.97 0 0 1-5-1.755" />
    </svg>
  ),
  // Remix Icon `ri-discord-fill`.
  discord: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.303 5.337A17.3 17.3 0 0 0 14.963 4c-.191.329-.403.775-.552 1.125a16.6 16.6 0 0 0-4.808 0C9.454 4.775 9.23 4.329 9.05 4a17 17 0 0 0-4.342 1.337C1.961 9.391 1.218 13.35 1.59 17.255a17.7 17.7 0 0 0 5.318 2.664a13 13 0 0 0 1.136-1.836c-.627-.234-1.22-.52-1.794-.86c.149-.106.297-.223.435-.34c3.46 1.582 7.207 1.582 10.624 0c.149.117.287.234.435.34c-.573.34-1.167.626-1.793.86a13 13 0 0 0 1.135 1.836a17.6 17.6 0 0 0 5.318-2.664c.457-4.52-.722-8.448-3.1-11.918M8.52 14.846c-1.04 0-1.889-.945-1.889-2.101s.828-2.102 1.89-2.102c1.05 0 1.91.945 1.888 2.102c0 1.156-.838 2.1-1.889 2.1m6.974 0c-1.04 0-1.89-.945-1.89-2.101s.828-2.102 1.89-2.102c1.05 0 1.91.945 1.889 2.102c0 1.156-.828 2.1-1.89 2.1" />
    </svg>
  ),
  // Remix Icon `ri-reddit-fill`.
  reddit: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.001 22c-5.523 0-10-4.477-10-10s4.477-10 10-10s10 4.477 10 10s-4.477 10-10 10m6.67-10a1.46 1.46 0 0 0-2.47-1a7.1 7.1 0 0 0-3.85-1.23l.65-3.12l2.14.45a1 1 0 1 0 .13-.61L12.821 6a.31.31 0 0 0-.37.24l-.74 3.47a7.14 7.14 0 0 0-3.9 1.23a1.46 1.46 0 1 0-1.61 2.39a3 3 0 0 0 0 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a3 3 0 0 0 0-.44a1.46 1.46 0 0 0 .81-1.33m-10 1a1 1 0 1 1 2 0a1 1 0 0 1-2 0m5.81 2.75a3.84 3.84 0 0 1-2.47.77a3.84 3.84 0 0 1-2.47-.77a.27.27 0 0 1 .38-.38a3.27 3.27 0 0 0 2.08.63a3.28 3.28 0 0 0 2.09-.61a.28.28 0 1 1 .39.4zm-.18-1.71a1 1 0 1 1 1-1a1 1 0 0 1-1.01 1.04z" />
    </svg>
  ),
  // Remix Icon `ri-medium-fill`.
  medium: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.158 3h11.684A3.16 3.16 0 0 1 21 6.158v3.366a4 4 0 0 0-.245-.008a2.91 2.91 0 0 0-2.294 1.1c-.472.586-.758 1.377-.828 2.266q-.022.266-.017.532c.047 2.014 1.135 3.624 3.068 3.624q.162 0 .316-.015v.82A3.16 3.16 0 0 1 17.842 21H6.158A3.16 3.16 0 0 1 3 17.842V6.158A3.16 3.16 0 0 1 6.158 3M21 15.388v-2.726h-1.653c-.074 1.316.646 2.43 1.653 2.726m0-3.107V9.973a1 1 0 0 0-.256-.035c-.815.017-1.3.992-1.36 2.343zM17.697 7.3l.015-.003v-.11h-2.9l-2.69 6.326L9.43 7.187H6.306v.11l.014.003c.529.12.797.298.797.94v7.52c0 .642-.27.82-.798.94l-.014.002v.11h2.12v-.11L8.41 16.7c-.529-.12-.798-.298-.798-.94V8.676l3.458 8.137h.196l3.559-8.364v7.496c-.046.508-.312.665-.791.773l-.014.003v.109h3.692v-.11l-.015-.002c-.48-.108-.752-.265-.797-.773l-.003-7.705h.003c0-.642.268-.82.797-.94" />
    </svg>
  ),
  // X-link kind glyphs (Axiom-style differentiation). Remix Icon:
  // ri-quill-pen-line (single tweet), ri-user-line (X account), ri-group-3-line (community).
  quillPen: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.94 14.033a30 30 0 0 0-.606 1.783c.96-.697 2.101-1.14 3.418-1.304c2.513-.314 4.746-1.973 5.876-4.058l-1.456-1.455l1.413-1.415l1-1.002c.43-.429.915-1.224 1.428-2.367c-5.593.867-9.018 4.291-11.074 9.818M17 8.997l1 1c-1 3-4 6-8 6.5q-4.003.5-5.002 5.5H3c1-6 3-20 18-20q-1.5 4.496-2.997 5.997z" />
    </svg>
  ),
  userLine: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 22a8 8 0 1 1 16 0h-2a6 6 0 0 0-12 0zm8-9c-3.315 0-6-2.685-6-6s2.685-6 6-6s6 2.685 6 6s-2.685 6-6 6m0-2c2.21 0 4-1.79 4-4s-1.79-4-4-4s-4 1.79-4 4s1.79 4 4 4" />
    </svg>
  ),
  group3: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8.5 7a2 2 0 1 1-4 0a2 2 0 0 1 4 0m-6 0a4 4 0 1 0 8 0a4 4 0 0 0-8 0M9 16.5a2.5 2.5 0 0 0-5 0V19h5zm2 4.5H2v-4.5a4.5 4.5 0 1 1 9 0zm8.5-14a2 2 0 1 1-4 0a2 2 0 0 1 4 0m-6 0a4 4 0 1 0 8 0a4 4 0 0 0-8 0m6.5 9.5a2.5 2.5 0 0 0-5 0V19h5zM13 19v-2.5a4.5 4.5 0 1 1 9 0V21h-9z" />
    </svg>
  ),
  // Remix Icon `ri-capsule-line` — launchpad ("pill") link.
  pill: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.779 4.222a6 6 0 0 1 0 8.485l-7.071 7.071a6 6 0 0 1-8.486-8.485l7.071-7.071a6 6 0 0 1 8.486 0m-5.657 11.313L8.466 9.878l-2.83 2.83a4 4 0 0 0 5.657 5.656zm4.242-9.899a4 4 0 0 0-5.657 0L9.88 8.464l5.657 5.657l2.827-2.828a4 4 0 0 0 0-5.657" />
    </svg>
  ),
  // Remix Icon `ri-search-line` — X search link.
  searchLine: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m18.031 16.617l4.283 4.282l-1.415 1.415l-4.282-4.283A8.96 8.96 0 0 1 11 20c-4.968 0-9-4.032-9-9s4.032-9 9-9s9 4.032 9 9a8.96 8.96 0 0 1-1.969 5.617m-2.006-.742A6.98 6.98 0 0 0 18 11c0-3.867-3.133-7-7-7s-7 3.133-7 7s3.133 7 7 7a6.98 6.98 0 0 0 4.875-1.975z" />
    </svg>
  ),
  bundle: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M3 5.1 8 2.9l5 2.2L8 7.4 3 5.1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M3.3 7.85 8 10l4.7-2.15M3.3 10.55 8 12.7l4.7-2.15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  sniper: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M9.1 1.2 4.3 8h3L6.6 14.8 11.8 7.2H8.7l.4-6Z" />
    </svg>
  ),
  clock: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 5v3.5l2 1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  filter: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  refresh: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M3 8a5 5 0 1 1 1.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3 4v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  swap: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 5h9l-2.5-2.5M13 11H4l2.5 2.5" />
    </svg>
  ),
  arrowUp: (s = 10) => (
    <svg width={s} height={s} viewBox="0 0 10 10">
      <path d="M5 2v6M2.5 4.5 5 2l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  arrowDown: (s = 10) => (
    <svg width={s} height={s} viewBox="0 0 10 10">
      <path d="M5 8V2M2.5 5.5 5 8l2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  rocketSharp: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M477.64 38.26a4.75 4.75 0 00-3.55-3.66c-58.57-14.32-193.9 36.71-267.22 110a317 317 0 00-35.63 42.1c-22.61-2-45.22-.33-64.49 8.07C52.38 218.7 36.55 281.14 32.14 308a9.64 9.64 0 0010.55 11.2l87.31-9.63a194.1 194.1 0 001.19 19.7 19.53 19.53 0 005.7 12L170.7 375a19.59 19.59 0 0012 5.7 193.53 193.53 0 0019.59 1.19l-9.58 87.2a9.65 9.65 0 0011.2 10.55c26.81-4.3 89.36-20.13 113.15-74.5 8.4-19.27 10.12-41.77 8.18-64.27a317.66 317.66 0 0042.21-35.64C441 232.05 491.74 99.74 477.64 38.26zM294.07 217.93a48 48 0 1167.86 0 47.95 47.95 0 01-67.86 0z" />
      <path d="M168.4 399.43c-5.48 5.49-14.27 7.63-24.85 9.46-23.77 4.05-44.76-16.49-40.49-40.52 1.63-9.11 6.45-21.88 9.45-24.88a4.37 4.37 0 00-3.65-7.45 60 60 0 00-35.13 17.12C50.22 376.69 48 464 48 464s87.36-2.22 110.87-25.75A59.69 59.69 0 00176 403.09c.37-4.18-4.72-6.67-7.6-3.66z" />
    </svg>
  ),
  bsc: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 2496 2496" aria-hidden="true" style={{ display: "block" }}>
      <path style={{ fillRule: "evenodd", clipRule: "evenodd", fill: "#f0b90b" }} d="M1248 0c689.3 0 1248 558.7 1248 1248s-558.7 1248-1248 1248S0 1937.3 0 1248 558.7 0 1248 0" />
      <path style={{ fill: "#fff" }} d="m685.9 1248 .9 330 280.4 165v193.2l-444.5-260.7v-524zm0-330v192.3l-163.3-96.6V821.4l163.3-96.6L850 821.4zm398.4-96.6 163.3-96.6 164.1 96.6-164.1 96.6z" />
      <path style={{ fill: "#fff" }} d="M803.9 1509.6v-193.2l163.3 96.6v192.3zm280.4 302.6 163.3 96.6 164.1-96.6v192.3l-164.1 96.6-163.3-96.6zm561.6-990.8 163.3-96.6 164.1 96.6v192.3l-164.1 96.6V918zm163.3 756.6.9-330 163.3-96.6v524l-444.5 260.7v-193.2z" />
      <path style={{ fill: "#fff" }} d="m1692.1 1509.6-163.3 95.7V1413l163.3-96.6z" />
      <path style={{ fill: "#fff" }} d="m1692.1 986.4.9 193.2-281.2 165v330.8l-163.3 95.7-163.3-95.7v-330.8l-281.2-165V986.4l164-96.6 279.5 165.8 281.2-165.8 164.1 96.6zM803.9 656.5l443.7-261.6 444.5 261.6-163.3 96.6-281.2-165.8-280.4 165.8z" />
    </svg>
  ),
  base: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="8" cy="8" r="8" fill="#0052FF" />
      <circle cx="8" cy="8" r="3.15" fill="#fff" />
    </svg>
  ),
  robinhood: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="8" cy="8" r="8" fill="#00C805" />
      <path d="M4.4 9.6c1.6-3.4 4.2-5.1 7.2-5.4-.2 1.7-1 3.3-2.4 4.6 1.5-.1 2.7.3 3.4 1.2-2.2.4-4.1-.1-5.6-1.5-.3 1.4-.2 2.7.4 3.9-1.8-.9-2.8-2.3-3-2.8Z" fill="#fff" />
    </svg>
  ),
  usdc: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 96 96" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M48 95c25.957 0 47-21.043 47-47S73.957 1 48 1 1 22.043 1 48s21.043 47 47 47" fill="#0b53bf" />
      <path d="M56.46 13.778v6.051C68.535 23.472 77.377 34.693 77.377 48c0 13.308-8.842 24.529-20.915 28.171v6.052C71.853 78.462 83.25 64.567 83.25 48c0-16.568-11.398-30.462-26.79-34.222M18.625 48c0-13.307 8.842-24.528 20.915-28.17v-6.052C24.148 17.538 12.75 31.432 12.75 48c0 16.567 11.398 30.462 26.79 34.222V76.17C27.467 72.557 18.625 61.307 18.625 48" fill="#fff" />
      <path d="M60.632 54.55c0-12.014-18.83-7.079-18.83-13.717 0-2.38 1.91-3.907 5.552-3.907 4.348 0 5.846 2.115 6.316 4.964h5.993c-.535-5.347-3.604-8.724-8.725-9.73v-4.722h-5.875v4.554c-5.61.714-9.135 3.981-9.135 8.84 0 12.074 18.858 7.55 18.858 14.071 0 2.468-2.38 4.113-6.404 4.113-5.258 0-6.99-2.321-7.637-5.523h-5.846c.38 5.857 3.99 9.523 10.164 10.438v4.632h5.875v-4.57c6.025-.78 9.694-4.284 9.694-9.442" fill="#fff" />
    </svg>
  ),
  eyeOff: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8s2.4-4.2 6-4.2c1.18 0 2.22.46 3.07 1.05M14 8s-1.13 1.97-3.13 3.27M9.4 9.4a2 2 0 1 1-2.8-2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M2.6 2.6 13.4 13.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  eye: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8s2.4-4.2 6-4.2S14 8 14 8s-2.4 4.2-6 4.2S2 8 2 8Z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  // Remix Icon `ri-eye-line` — live views.
  eyeLine: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M12.0003 3C17.3924 3 21.8784 6.87976 22.8189 12C21.8784 17.1202 17.3924 21 12.0003 21C6.60812 21 2.12215 17.1202 1.18164 12C2.12215 6.87976 6.60812 3 12.0003 3ZM12.0003 19C16.2359 19 19.8603 16.052 20.7777 12C19.8603 7.94803 16.2359 5 12.0003 5C7.7646 5 4.14022 7.94803 3.22278 12C4.14022 16.052 7.7646 19 12.0003 19ZM12.0003 16.5C9.51498 16.5 7.50026 14.4853 7.50026 12C7.50026 9.51472 9.51498 7.5 12.0003 7.5C14.4855 7.5 16.5003 9.51472 16.5003 12C16.5003 14.4853 14.4855 16.5 12.0003 16.5ZM12.0003 14.5C13.381 14.5 14.5003 13.3807 14.5003 12C14.5003 10.6193 13.381 9.5 12.0003 9.5C10.6196 9.5 9.50026 10.6193 9.50026 12C9.50026 13.3807 10.6196 14.5 12.0003 14.5Z" />
    </svg>
  ),
  // Remix Icon `ri-refund-2-line` — cashback enabled.
  refund: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M5.67591 4.25667C9.60392 1.03828 15.4094 1.26236 19.076 4.92893C22.9812 8.83418 22.9812 15.1658 19.076 19.0711C15.1707 22.9763 8.83906 22.9763 4.93382 19.0711C2.40932 16.5466 1.51676 13.0081 2.25611 9.76666L2.33275 9.45394L4.26718 9.96315C3.56967 12.623 4.26329 15.5721 6.34803 17.6569C9.47222 20.781 14.5375 20.781 17.6617 17.6569C20.7859 14.5327 20.7859 9.46734 17.6617 6.34315C14.8441 3.5255 10.4475 3.24903 7.32006 5.51375L7.09886 5.67983L8.1158 6.6967L3.5196 7.75736L4.58026 3.16117L5.67591 4.25667ZM13.0049 6V8H15.5049V10H10.0049C9.72874 10 9.50488 10.2239 9.50488 10.5C9.50488 10.7455 9.68176 10.9496 9.91501 10.9919L10.0049 11H14.0049C15.3856 11 16.5049 12.1193 16.5049 13.5C16.5049 14.8807 15.3856 16 14.0049 16H13.0049V18H11.0049V16H8.50488V14H14.0049C14.281 14 14.5049 13.7761 14.5049 13.5C14.5049 13.2545 14.328 13.0504 14.0948 13.0081L14.0049 13H10.0049C8.62417 13 7.50488 11.8807 7.50488 10.5C7.50488 9.11929 8.62417 8 10.0049 8H11.0049V6H13.0049Z" />
    </svg>
  ),
  // Remix Icon `ri-vip-crown-2-line` — dev migration count.
  vipCrown2: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M3.49709 8.06464L4.78355 18.9996H19.2266L20.513 8.06464L16.5032 10.7379L12.0051 4.44051L7.50694 10.7379L3.49709 8.06464ZM2.80577 5.20006L7.00505 7.99958L11.1913 2.13881C11.5123 1.6894 12.1369 1.58531 12.5863 1.90631C12.6761 1.97045 12.7546 2.04901 12.8188 2.13881L17.0051 7.99958L21.2043 5.20006C21.6639 4.89371 22.2847 5.01788 22.5911 5.47741C22.7228 5.67503 22.7799 5.91308 22.7522 6.14895L21.109 20.1164C21.0497 20.62 20.6229 20.9996 20.1158 20.9996H3.8943C3.38722 20.9996 2.9604 20.62 2.90115 20.1164L1.25792 6.14895C1.19339 5.60045 1.58573 5.10349 2.13423 5.03896C2.37011 5.01121 2.60816 5.06832 2.80577 5.20006ZM12.0051 14.9996C10.9005 14.9996 10.0051 14.1042 10.0051 12.9996C10.0051 11.895 10.9005 10.9996 12.0051 10.9996C13.1096 10.9996 14.0051 11.895 14.0051 12.9996C14.0051 14.1042 13.1096 14.9996 12.0051 14.9996Z" />
    </svg>
  ),
  // DNA double-helix — "Clone token" (relaunch from an existing token's meta).
  dna: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M8 3C8 8 16 8 16 12C16 16 8 16 8 21M16 3C16 8 8 8 8 12C8 16 16 16 16 21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9.2 6H14.8M10 9H14M10 15H14M9.2 18H14.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  pause: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <rect x="4" y="3" width="2.5" height="10" rx="0.6" />
      <rect x="9.5" y="3" width="2.5" height="10" rx="0.6" />
    </svg>
  ),
  play: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
      <path d="M5 3.2v9.6a.5.5 0 0 0 .77.42l7.2-4.8a.5.5 0 0 0 0-.84l-7.2-4.8A.5.5 0 0 0 5 3.2Z" />
    </svg>
  ),
  star: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.2 9.78 5.8l3.97.58-2.87 2.8.68 3.95L8 11.27l-3.55 1.86.68-3.95-2.87-2.8 3.97-.58L8 2.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  starFilled: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 2.2 9.78 5.8l3.97.58-2.87 2.8.68 3.95L8 11.27l-3.55 1.86.68-3.95-2.87-2.8 3.97-.58L8 2.2Z" />
    </svg>
  ),
};
