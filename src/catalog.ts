import {
  FILE_CAPTIONS,
  INVOICE_DESCRIPTION,
  INVOICE_TITLE,
  PIXEL_BENEFITS,
  PIXEL_CHECKOUT,
  PIXEL_FAQ,
  PIXEL_HOME,
  PIXEL_INSIDE,
  PIXEL_MONEY,
  PIXEL_THANKS,
  STAR_PRICE,
} from "./texts";

export interface Product {
  id: string;
  button: string;
  title: string;
  hidden: boolean;
  priceStars: number;
  invoiceTitle: string;
  invoiceDescription: string;
  invoiceLabel: string;
  coverSlot: string;
  coverFile: string;
  screens: {
    home: string;
    inside: string;
    benefits: string;
    money: string;
    faq: string;
    checkout: string;
    thanks: string;
  };
  fileCaptions: string[];
}

// Новый продукт: добавь объект сюда (hidden: true, пока не готов) и загрузи файлы командой /setfiles.
const PRODUCTS: Product[] = [
  {
    id: "pixelverse",
    button: "👾 PIXEL VERSE",
    title: "PIXEL VERSE · Мультстудия в кармане",
    hidden: false,
    priceStars: STAR_PRICE,
    invoiceTitle: INVOICE_TITLE,
    invoiceDescription: INVOICE_DESCRIPTION,
    invoiceLabel: "Курс",
    coverSlot: "pixelverse",
    coverFile: "pixelverse-cover.jpg",
    screens: {
      home: PIXEL_HOME,
      inside: PIXEL_INSIDE,
      benefits: PIXEL_BENEFITS,
      money: PIXEL_MONEY,
      faq: PIXEL_FAQ,
      checkout: PIXEL_CHECKOUT,
      thanks: PIXEL_THANKS,
    },
    fileCaptions: FILE_CAPTIONS,
  },
];

export function listAllProducts(): Product[] {
  return PRODUCTS;
}

export function listVisibleProducts(): Product[] {
  return PRODUCTS.filter((product) => !product.hidden);
}

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}

export function productIds(): string[] {
  return PRODUCTS.map((product) => product.id);
}
