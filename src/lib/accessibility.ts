import type { AccessibilityBand, AccessibilityReason } from '../types.ts'

export const ACCESSIBILITY_VISUALS = [
  { score: 1, color: '#46a06d', label: 'かなり行きやすい' },
  { score: 2, color: '#8db548', label: '行きやすい' },
  { score: 3, color: '#d2ad42', label: 'ふつう' },
  { score: 4, color: '#f07f45', label: 'やや大変' },
  { score: 5, color: '#d85b52', label: '遠征向け' },
] as const

const BAND_LABELS: Record<AccessibilityBand, string> = {
  easy: 'かなり行きやすい',
  fair: '行きやすい',
  moderate: 'ふつう',
  hard: 'やや大変',
  remote: '遠征向け',
}

const REASON_LABELS: Record<AccessibilityReason, string> = {
  station_nearby: '駅から近い',
  bus_access: 'バスで寄りやすい',
  ferry_access: '港から寄りやすい',
  airport_nearby: '空港が比較的近い',
  intl_airport_access: '国際線空港が近い',
  shinkansen_access: '新幹線で入りやすい',
  gateway_city_access: '主要都市から入りやすい',
  clustered_trip: '周辺のふたと回りやすい',
  island: '離島エリア',
  mountain: '山あいエリア',
  transit_sparse: '公共交通が少なめ',
  remote_area: '移動計画が必要',
}

export function getAccessibilityVisual(score: number) {
  return (
    ACCESSIBILITY_VISUALS.find((entry) => entry.score === score) ??
    ACCESSIBILITY_VISUALS[2]
  )
}

export function getAccessibilityBandLabel(band: AccessibilityBand) {
  return BAND_LABELS[band]
}

export function getAccessibilityReasonLabel(reason: AccessibilityReason) {
  return REASON_LABELS[reason]
}
