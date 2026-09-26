// The palette, declared once. The root layout writes these as light-dark()
// custom properties, public/input.css maps them into utilities, and /brand
// prints the same values, so the three cannot drift.
//
// Neutrals carry everything. The glow is the one accent: the primary action,
// live state and the focus ring. It never tints a panel or colours a heading,
// and it never carries text on paper (it fails contrast there): it is a
// background with near-black type on it, a dot, or an outline.
export interface Swatch {
  /** The custom property's name, without the leading dashes. */
  token: string;
  /** What the colour is for, in a few words. */
  role: string;
  light: string;
  dark: string;
  /** Printed on /brand. The derived hover and tint values are not. */
  print?: boolean;
}

export const PALETTE: readonly Swatch[] = [
  { token: 'paper', role: 'the page', light: '#f8f6f1', dark: '#0f1013', print: true },
  { token: 'paper-elev', role: 'panels and cards', light: '#fffdf9', dark: '#16181d', print: true },
  { token: 'paper-sunken', role: 'code and wells', light: '#f0ece4', dark: '#0a0b0e' },
  { token: 'paper-subtle', role: 'hover and columns', light: '#ebe6dc', dark: '#1c1f25' },
  { token: 'ink', role: 'text and the mark', light: '#17181c', dark: '#ebe8e1', print: true },
  { token: 'ink-muted', role: 'body prose', light: '#565a62', dark: '#9ca1ab', print: true },
  { token: 'ink-subtle', role: 'captions and labels', light: '#82868f', dark: '#6c727c', print: true },
  { token: 'rule', role: 'hairlines and borders', light: '#dfd9cc', dark: '#242830', print: true },
  { token: 'rule-strong', role: 'inputs and emphasised rules', light: '#c8c1b1', dark: '#353b45' },
  { token: 'glow', role: 'the one accent', light: '#ff9d1c', dark: '#ffb13d', print: true },
  { token: 'glow-hover', role: 'the accent under a cursor', light: '#f28f0a', dark: '#ffc061' },
  { token: 'glow-ink', role: 'type on the accent', light: '#1a1206', dark: '#14100a' },
  { token: 'glow-tint', role: 'a wash of the accent', light: '#fff0d8', dark: '#2c2110' },
  { token: 'alert', role: 'errors only', light: '#c9412a', dark: '#ff7a5c', print: true },
  { token: 'success', role: 'a passed check, as type', light: '#3f7d1a', dark: '#9be36a' },
];

/** The CSS declarations for :root, one light-dark() per token. */
export function paletteCss(): string {
  return PALETTE.map((s) => `--${s.token}: light-dark(${s.light}, ${s.dark});`).join('\n        ');
}
