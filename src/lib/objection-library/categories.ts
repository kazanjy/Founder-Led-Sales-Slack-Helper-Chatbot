export interface CategoryInfo {
  key: string;
  label: string;
  description: string;
  color: string;       // Tailwind bg color class
  textColor: string;   // Tailwind text color class
  borderColor: string; // Tailwind border color class
}

export const OBJECTION_CATEGORIES: Record<string, CategoryInfo> = {
  NEED: {
    key: "NEED",
    label: "Need & Problem Recognition",
    description: "Do I actually have this problem?",
    color: "bg-red-50",
    textColor: "text-red-700",
    borderColor: "border-red-200",
  },
  PRIORITY: {
    key: "PRIORITY",
    label: "Priority & Urgency",
    description: "Is this worth solving now vs. other things?",
    color: "bg-orange-50",
    textColor: "text-orange-700",
    borderColor: "border-orange-200",
  },
  ROI: {
    key: "ROI",
    label: "ROI & Value Justification",
    description: "Can I justify the spend with concrete returns?",
    color: "bg-yellow-50",
    textColor: "text-yellow-700",
    borderColor: "border-yellow-200",
  },
  PRODUCT: {
    key: "PRODUCT",
    label: "Product Fit & Capabilities",
    description: "Does this product solve my problem well enough?",
    color: "bg-blue-50",
    textColor: "text-blue-700",
    borderColor: "border-blue-200",
  },
  COMPETITION: {
    key: "COMPETITION",
    label: "Competition & Alternatives",
    description: "Is this the best option, including build-vs-buy?",
    color: "bg-indigo-50",
    textColor: "text-indigo-700",
    borderColor: "border-indigo-200",
  },
  ADOPTION: {
    key: "ADOPTION",
    label: "Adoption & Implementation",
    description: "Will my team actually use this? Can we make the switch?",
    color: "bg-green-50",
    textColor: "text-green-700",
    borderColor: "border-green-200",
  },
  BUDGET: {
    key: "BUDGET",
    label: "Price & Budget",
    description: "Can I afford this / is it priced fairly?",
    color: "bg-emerald-50",
    textColor: "text-emerald-700",
    borderColor: "border-emerald-200",
  },
  TRUST: {
    key: "TRUST",
    label: "Trust & Vendor Risk",
    description: "Can I trust this company to deliver and survive?",
    color: "bg-purple-50",
    textColor: "text-purple-700",
    borderColor: "border-purple-200",
  },
  AUTHORITY: {
    key: "AUTHORITY",
    label: "Authority & Process",
    description: "Can I actually get this approved internally?",
    color: "bg-pink-50",
    textColor: "text-pink-700",
    borderColor: "border-pink-200",
  },
};

export const CATEGORY_KEYS = Object.keys(OBJECTION_CATEGORIES);

export function getCategoryInfo(key: string): CategoryInfo {
  return OBJECTION_CATEGORIES[key] || OBJECTION_CATEGORIES.NEED;
}
