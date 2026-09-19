/* AUTO-GENERATED from solana/crates/parser/data/launchpad_registry.json — do not edit.
 * Regenerate: python3 solana/scripts/gen_launchpad_registry.py
 */
export interface PlatformChip {
  label: string;
  value: string;
}

/** Curated Solana launchpad chips (competitor parity + high-signal brands). */
export const SOL_PLATFORM_CHIPS: PlatformChip[] = [
  {
    "label": "Pumpfun",
    "value": "Pumpfun"
  },
  {
    "label": "Mayhem",
    "value": "Mayhem"
  },
  {
    "label": "Bonk",
    "value": "LetsBonk"
  },
  {
    "label": "Bonkers",
    "value": "Bonkers"
  },
  {
    "label": "Bags",
    "value": "Bags"
  },
  {
    "label": "Believe",
    "value": "Believe"
  },
  {
    "label": "Studio",
    "value": "JupiterStudio"
  },
  {
    "label": "Moonshot",
    "value": "Moonshot"
  },
  {
    "label": "Moonit",
    "value": "Moonit"
  },
  {
    "label": "Trends",
    "value": "TrendsFun"
  },
  {
    "label": "Orynth",
    "value": "Orynth"
  },
  {
    "label": "Printr",
    "value": "Printr"
  },
  {
    "label": "Bankr",
    "value": "Bankr"
  },
  {
    "label": "Heaven",
    "value": "Heaven"
  },
  {
    "label": "Boop.fun",
    "value": "Boopfun"
  },
  {
    "label": "Sugar",
    "value": "Sugar"
  },
  {
    "label": "Zora",
    "value": "ZoraSolana"
  },
  {
    "label": "TokenMill",
    "value": "TokenMillV2"
  },
  {
    "label": "America",
    "value": "AmericaFun"
  },
  {
    "label": "DubDub",
    "value": "DubDub"
  },
  {
    "label": "Forge",
    "value": "Forge"
  },
  {
    "label": "Blowfish",
    "value": "Blowfish"
  },
  {
    "label": "Cooking",
    "value": "CookingCity"
  },
  {
    "label": "Sendshot",
    "value": "Sendshot"
  },
  {
    "label": "Pons",
    "value": "Pons"
  },
  {
    "label": "Time.fun",
    "value": "TimeFun"
  },
  {
    "label": "Xymint",
    "value": "Xymint"
  },
  {
    "label": "Memoo",
    "value": "Memoo"
  },
  {
    "label": "Liquid",
    "value": "Liquid"
  },
  {
    "label": "Surge",
    "value": "Surge"
  },
  {
    "label": "Wen.dev",
    "value": "Wendev"
  },
  {
    "label": "Cults",
    "value": "Cults"
  },
  {
    "label": "OhFuck",
    "value": "OhFuckFun"
  },
  {
    "label": "Coinbarrel",
    "value": "Coinbarrel"
  },
  {
    "label": "LaunchLab",
    "value": "RaydiumLaunchpad"
  },
  {
    "label": "Dynamic BC",
    "value": "MeteoraDBC"
  },
  {
    "label": "Rise",
    "value": "Rise"
  }
];

/** Brand → infrastructure family (for icons / fallbacks). */
export const PLATFORM_FAMILY: Record<string, string> = {
  Bags: "MeteoraDBC",
  Believe: "MeteoraDBC",
  JupiterStudio: "MeteoraDBC",
  Moonshot: "MeteoraDBC",
  TrendsFun: "MeteoraDBC",
  Orynth: "MeteoraDBC",
  Printr: "MeteoraDBC",
  AmericaFun: "MeteoraDBC",
  DubDub: "MeteoraDBC",
  Forge: "MeteoraDBC",
  Blowfish: "MeteoraDBC",
  CookingCity: "MeteoraDBC",
  Sendshot: "MeteoraDBC",
  Pons: "MeteoraDBC",
  TimeFun: "MeteoraDBC",
  Xymint: "MeteoraDBC",
  LetsBonkDBC: "MeteoraDBC",
  LetsBonk: "RaydiumLaunchpad",
  Bonkers: "RaydiumLaunchpad",
  Bankr: "RaydiumLaunchpad",
  Memoo: "RaydiumLaunchpad",
  Liquid: "RaydiumLaunchpad",
  Surge: "RaydiumLaunchpad",
  Wendev: "RaydiumLaunchpad",
  Cults: "RaydiumLaunchpad",
  OhFuckFun: "RaydiumLaunchpad",
  Coinbarrel: "RaydiumLaunchpad",
  Kickstart: "RaydiumLaunchpad",
};

/** Brand → /platforms/{file} (Codex S3 + Fury SVG + LaunchLab img). */
export const PLATFORM_ICONS: Record<string, string> = {
  "Pumpfun": "pumpfun.svg",
  "PumpSwap": "pumpswap.svg",
  "Mayhem": "mayhem.svg",
  "LetsBonk": "letsbonk.svg",
  "Bonkers": "bonkers.svg",
  "Bags": "bags.svg",
  "Believe": "believe.png",
  "JupiterStudio": "jupiterstudio.svg",
  "Moonshot": "moonshot.svg",
  "Moonit": "moonit.svg",
  "TrendsFun": "trendsfun.png",
  "Printr": "printr.svg",
  "Bankr": "bankr.svg",
  "Heaven": "heaven.svg",
  "Boopfun": "boopfun.svg",
  "Sugar": "sugar.svg",
  "ZoraSolana": "zora.svg",
  "TokenMillV2": "tokenmill.jpg",
  "TokenMillV1": "tokenmill.jpg",
  "AmericaFun": "americafun.jpg",
  "DubDub": "dubdub.png",
  "Forge": "forge.jpg",
  "Blowfish": "blowfish.jpg",
  "CookingCity": "cookingcity.jpg",
  "Sendshot": "sendshot.png",
  "Pons": "pons.svg",
  "TimeFun": "timefun.png",
  "Memoo": "memoo.jpg",
  "Liquid": "liquid.svg",
  "Surge": "surge.svg",
  "Wendev": "wendev.jpg",
  "Cults": "cults.png",
  "OhFuckFun": "ohfuckfun.png",
  "Coinbarrel": "coinbarrel.png",
  "Kickstart": "kickstart.jpg",
  "Rise": "rise.jpg",
  "RaydiumLaunchpad": "raydium.svg",
  "MeteoraDBC": "meteora.svg"
};

export const REGISTRY_GENERATED = "2026-07-22T22:36:35Z";
