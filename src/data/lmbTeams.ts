export interface LmbTeamMeta {
  color: string
  color2: string
}

// Colors are placeholders — user will provide final values
const LMB_TEAMS: Record<string, LmbTeamMeta> = {
  MTY: { color: '#003087', color2: '#E31837' }, // Sultanes de Monterrey
  LAG: { color: '#002B5C', color2: '#D4AF37' }, // Algodoneros de Laguna
  CAM: { color: '#1A1A2E', color2: '#C8A951' }, // Piratas de Campeche
  MEX: { color: '#CC0000', color2: '#000000' }, // Diablos Rojos del México
  OAX: { color: '#006400', color2: '#FFD700' }, // Guerreros de Oaxaca
  PUE: { color: '#006B3F', color2: '#FFD700' }, // Pericos de Puebla
  LAR: { color: '#1E3A5F', color2: '#C8A951' }, // Tecos (Dos Laredos)
  AGS: { color: '#002B7F', color2: '#C41E3A' }, // Rieleros de Aguascalientes
  TIJ: { color: '#C41E3A', color2: '#000000' }, // Toros de Tijuana
  SLW: { color: '#CC0000', color2: '#FFFFFF' }, // Saraperos de Saltillo
  MVA: { color: '#003087', color2: '#C0C0C0' }, // Acereros de Monclova
  JAL: { color: '#1C4587', color2: '#BF9000' }, // Charros de Jalisco
  QRO: { color: '#003087', color2: '#C41E3A' }, // Conspiradores de Querétaro
  VER: { color: '#002B5C', color2: '#CC0000' }, // El Águila de Veracruz
  LEO: { color: '#003087', color2: '#FFD700' }, // Bravos de León
  YUC: { color: '#FFD700', color2: '#003087' }, // Leones de Yucatán
  TIG: { color: '#FF6600', color2: '#000000' }, // Tigres de Quintana Roo
  TAB: { color: '#003087', color2: '#008000' }, // Olmecas de Tabasco
  CHI: { color: '#FFD700', color2: '#CC0000' }, // Dorados de Chihuahua
  DUR: { color: '#003087', color2: '#CC0000' }, // Caliente de Durango
}

export function getLmbTeamMeta(shortName: string): LmbTeamMeta {
  return LMB_TEAMS[shortName] ?? { color: '#444', color2: '#666' }
}
