import React from "react";
import type { Category } from "../engine/types";

type P = { size?: number };
const S = (d: React.ReactNode) =>
  function Icon({ size }: P) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {d}
      </svg>
    );
  };

export const IMarket = S(<><path d="M3 9.5 4.6 4h14.8L21 9.5" /><path d="M3 9.5h18v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" /><path d="M5 13.4V20h14v-6.6" /><path d="M10 20v-4h4v4" /></>);
export const IPulse = S(<><path d="M3 12h4l2.5-6 5 12 2.5-6H21" /></>);
export const IPie = S(<><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>);
export const IReceipt = S(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>);
export const IUser = S(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
export const IStore = S(<><path d="M4 10v10h16V10" /><path d="M2.5 10 5 4h14l2.5 6z" /><path d="M9 20v-5h6v5" /></>);
export const IShield = S(<><path d="M12 3 4.5 6v6c0 4.5 3.2 8 7.5 9 4.3-1 7.5-4.5 7.5-9V6z" /><path d="m9 12 2 2 4-4" /></>);
export const IPlus = S(<><path d="M12 5v14M5 12h14" /></>);
export const IBack = S(<><path d="M15 5 8 12l7 7" /></>);
export const IChevron = S(<><path d="m9 5 7 7-7 7" /></>);
export const ICheck = S(<><path d="m5 12.5 4.5 4.5L19 7.5" /></>);
export const IX = S(<><path d="M6 6l12 12M18 6 6 18" /></>);
export const IClock = S(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IBolt = S(<><path d="M13 3 5 14h6l-1 7 8-11h-6z" /></>);
export const ICoin = S(<><circle cx="12" cy="12" r="8.5" /><path d="M14.8 9.3c-.6-.8-1.6-1.3-2.8-1.3-1.7 0-2.8.9-2.8 2s1 1.7 2.8 2 2.8.9 2.8 2-1.1 2-2.8 2c-1.2 0-2.3-.5-2.9-1.4M12 6.5V8M12 16v1.5" /></>);
export const IGlobe = S(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></>);
export const IUpload = S(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>);
export const IFile = S(<><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>);
export const ILock = S(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>);
export const IPin = S(<><path d="M12 21s-6.5-5.5-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>);
export const ICamera = S(<><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="3.8" /><circle cx="17" cy="7" r="0.6" fill="currentColor" /></>);
export const IBank = S(<><path d="M3 9.5 12 4l9 5.5" /><path d="M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20h18" /></>);
export const IScale = S(<><path d="M12 4v16M7 20h10M5 7h14" /><path d="m5 7-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z" /></>);
export const IId = S(<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 16c.6-1.4 1.8-2.2 3.2-2.2s2.6.8 3.2 2.2M14.5 10h4M14.5 13.5h3" /></>);
export const ISpark = S(<><path d="M12 3c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6z" /><path d="M18.5 15c.3 1.7.9 2.3 2.5 2.5-1.6.3-2.2.9-2.5 2.5-.3-1.6-.9-2.2-2.5-2.5 1.6-.2 2.2-.8 2.5-2.5z" /></>);
export const IUp = S(<><path d="M12 19V5M6 11l6-6 6 6" /></>);
export const IDown = S(<><path d="M12 5v14M6 13l6 6 6-6" /></>);
export const IFast = S(<><path d="M4 6l7 6-7 6zM12 6l7 6-7 6z" /></>);
export const ISun = S(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" /></>);
export const IMoon = S(<><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></>);
export const IBell = S(<><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><path d="M10 20a2 2 0 0 0 4 0" /></>);
export const IChat = S(<><path d="M4 5h16v11H9l-5 4z" /></>);
export const IThumb = S(<><path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.6 10H19a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7" /></>);
export const IAlert = S(<><path d="M12 3 2 20h20z" /><path d="M12 10v4.5M12 17.2v.3" /></>);
export const IBuilding = S(<><path d="M5 21V4h10v17M15 9h4v12M3 21h18" /><path d="M8 8h1M11 8h1M8 12h1M11 12h1M8 16h1M11 16h1" /></>);
export const ISearch = S(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const ITool = S(<><path d="M14.5 5.5a4 4 0 0 0-5 5L4 16v4h4l5.5-5.5a4 4 0 0 0 5-5L16 12l-4-4z" /></>);
export const IThink = S(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></>);
export const ISwap = S(<><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></>);
export const IGift = S(<><rect x="3.5" y="8" width="17" height="5" rx="1" /><path d="M5 13v8h14v-8M12 8v13M12 8C10 4 6.5 4.5 7.5 7c.4 1 2 1 4.5 1zM12 8c2-4 5.5-3.5 4.5-1-.4 1-2 1-4.5 1z" /></>);
export const ITrophy = S(<><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7M10 17h4v3h-4z" /></>);
export const IDoc = IFile;
export const IHand = S(<><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v7M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13c0 4.5-2.5 8-6.5 8-3 0-4.6-1.6-6-4l-1.8-3.3a1.4 1.4 0 0 1 2.3-1.6L8 14" /></>);
export const ILang = S(<><path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 5.5 5.5 7M11 5c-.8 3.3-3 6-6.5 7.5" /><path d="m13 21 4-9 4 9M14.5 18h5" /></>);

const CAT: Record<Category, React.ReactNode> = {
  bar: <><path d="M5 4h14l-7 8z" /><path d="M12 12v8M8 20h8" /></>,
  restaurant: <><path d="M3 11h18a9 9 0 0 1-18 0z" /><path d="M8 7c0-1.5 1-1.5 1-3M12 7c0-1.5 1-1.5 1-3M16 7c0-1.5 1-1.5 1-3" /></>,
  cafe: <><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v2M12 3v2" /></>,
  teashop: <><path d="M6 7h12l-1.5 14h-9z" /><path d="M5 7h14M13 7l2-5" /><circle cx="10" cy="17" r="1" /><circle cx="13.5" cy="18" r="1" /></>,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>,
  ecommerce: <><path d="M5 8h14l-1 13H6z" /><path d="M9 10V6a3 3 0 0 1 6 0v4" /></>,
  game: <><rect x="2.5" y="7" width="19" height="11" rx="5" /><path d="M7 11v3M5.5 12.5h3M15.5 12h.01M18 13.5h.01" /></>,
  creator: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3z" /></>,
  energy: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  hotel: <><path d="M3 18V7M3 13h18v5M21 13v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="10.5" r="1.8" /></>,
  carwash: <><path d="M12 3s-5 5.5-5 9a5 5 0 0 0 10 0c0-3.5-5-9-5-9z" /></>,
  ev: <><path d="M9 3v4M15 3v4M6 7h12v4a6 6 0 0 1-12 0zM12 17v4" /></>,
};

export function CatIcon({ category, size }: { category: Category; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {CAT[category]}
    </svg>
  );
}
