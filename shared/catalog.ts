import type { Product } from "./model";

// Демо-каталог для проверки конструктора; цены заданы в копейках.
export const products: Product[] = [
  {
    id: "classic",
    name: "Футболка Classic",
    description: "Демонстрационная футболка классического кроя.",
    basePrice: 120000,
    sidePrice: 25000,
    colors: [
      { id: "white", name: "Белый", hex: "#ffffff" },
      { id: "black", name: "Чёрный", hex: "#000000" },
      { id: "blue", name: "Синий", hex: "#2563eb" },
    ],
    sizes: ["S", "M", "L", "XL", "XXL"],
    areas: {
      front: { width: 240, height: 320 },
      back: { width: 240, height: 320 },
    },
    mockups: {
      front: "/assets/shirt-front.png",
      back: "/assets/shirt-back.png",
    },
    demo: true,
  },
  {
    id: "oversize",
    name: "Футболка Oversize",
    description: "Демонстрационная футболка свободного кроя.",
    basePrice: 150000,
    sidePrice: 30000,
    colors: [
      { id: "white", name: "Белый", hex: "#ffffff" },
      { id: "black", name: "Чёрный", hex: "#000000" },
      { id: "blue", name: "Синий", hex: "#2563eb" },
    ],
    sizes: ["S", "M", "L", "XL", "XXL"],
    areas: {
      front: { width: 280, height: 360 },
      back: { width: 280, height: 360 },
    },
    mockups: {
      front: "/assets/shirt-front.png",
      back: "/assets/shirt-back.png",
    },
    demo: true,
  },
];

export const exportDpi = 300;
export const qualityWarningDpi = 150;
