/**
 * src/vton/AnywearPresets.ts
 *
 * The 4 Featured Garment Presets from Decart Anywear:
 * 1. Classic Oxford Button-Down Shirt
 * 2. Streetwear Pullover Hoodie
 * 3. Vintage Crewneck Sweatshirt
 * 4. Ribbed High-Neck / Turtleneck Sweater
 */

export interface AnywearGarment {
  id: string;
  name: string;
  category: "shirt" | "hoodie" | "sweatshirt" | "highneck";
  tag: string;
  description: string;
  imageUrl: string;
  thumbnailUrl: string;
  prompt: string;
  fitting: {
    collarHeight: number; // e.g. 0.08 for highneck, 0.04 for shirt
    shoulderFit: "fitted" | "relaxed" | "oversized";
    chestFitRatio: number;
    torsoLengthRatio: number;
    sleeveLength: "short" | "long";
  };
}

export const ANYWEAR_PRESETS: AnywearGarment[] = [
  {
    id: "classic-shirt",
    name: "Classic Oxford Shirt",
    category: "shirt",
    tag: "Formal & Casual",
    description: "Crisp light blue woven cotton Oxford button-down shirt with structured point collar and button cuffs.",
    imageUrl: "/assets/anywear/shirt.png",
    thumbnailUrl: "/assets/anywear/shirt.png",
    prompt: "Substitute the current top with a crisp light blue tailored cotton Oxford button-down shirt with a clean buttoned collar",
    fitting: {
      collarHeight: 0.04,
      shoulderFit: "fitted",
      chestFitRatio: 1.02,
      torsoLengthRatio: 1.05,
      sleeveLength: "long",
    },
  },
  {
    id: "streetwear-hoodie",
    name: "Streetwear Hoodie",
    category: "hoodie",
    tag: "Streetwear",
    description: "Heavyweight dark charcoal French-terry pullover hoodie with a draped double-layer hood and kangaroo pocket.",
    imageUrl: "/assets/anywear/hoodie.png",
    thumbnailUrl: "/assets/anywear/hoodie.png",
    prompt: "Substitute the current top with a premium heavyweight dark charcoal oversized streetwear pullover hoodie with a draped hood and drawstrings",
    fitting: {
      collarHeight: 0.06,
      shoulderFit: "oversized",
      chestFitRatio: 1.15,
      torsoLengthRatio: 1.10,
      sleeveLength: "long",
    },
  },
  {
    id: "vintage-sweatshirt",
    name: "Vintage Crewneck",
    category: "sweatshirt",
    tag: "Casual Fleece",
    description: "Relaxed-fit heather grey cotton-fleece crewneck sweatshirt with ribbed collar, drop shoulders, and snug cuffs.",
    imageUrl: "/assets/anywear/sweatshirt.png",
    thumbnailUrl: "/assets/anywear/sweatshirt.png",
    prompt: "Substitute the current top with a cozy heather grey vintage relaxed-fit cotton-fleece crewneck sweatshirt with ribbed collar and cuffs",
    fitting: {
      collarHeight: 0.03,
      shoulderFit: "relaxed",
      chestFitRatio: 1.08,
      torsoLengthRatio: 1.04,
      sleeveLength: "long",
    },
  },
  {
    id: "highneck-sweater",
    name: "Ribbed High-Neck Sweater",
    category: "highneck",
    tag: "Knitwear / Turtleneck",
    description: "Chunky oatmeal wool-blend ribbed knit sweater featuring a luxurious snug roll-neck collar and structured ribbed sleeves.",
    imageUrl: "/assets/anywear/highneck.png",
    thumbnailUrl: "/assets/anywear/highneck.png",
    prompt: "Substitute the current top with a chunky oatmeal cream ribbed knit wool turtleneck sweater with a high fold-over neck collar",
    fitting: {
      collarHeight: 0.09, // High roll-neck collar extends up the throat
      shoulderFit: "relaxed",
      chestFitRatio: 1.06,
      torsoLengthRatio: 1.06,
      sleeveLength: "long",
    },
  },
];
