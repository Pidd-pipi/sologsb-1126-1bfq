/**
 * RiskVeto（风险否决项）—— 命中即标红该营位并压到 C 级。
 * 属于「一票否决」类硬约束，与得分体系解耦。
 *
 * 生命周期：
 *   登记（active）→ 下次复查日期到期仍未解除：保持 C 级，名次表标「待复查」
 *   → 现场复核无问题，由复核人写结论与日期解除（resolved），记录留在台账中，
 *     该营位重新按当前权重参与评级。
 */
import { todayIso } from '@/utils/format'

/** 否决类型 */
export type VetoType = '河道内' | '山洪沟' | '孤树下' | '崖底落石区' | '陡坡'

/** 否决记录状态：生效中 / 已复核解除 */
export type VetoStatus = 'active' | 'resolved'

export interface RiskVeto {
  /** 主键，自增 */
  id?: number
  /** 被否决的营位 id */
  siteId: number
  /** 否决类型 */
  type: VetoType
  /** 说明（现场情况、判定依据） */
  description: string
  /** 判定人 */
  judge: string
  /** 判定日期（YYYY-MM-DD） */
  judgedAt: string
  /** 下次复查日期（YYYY-MM-DD）：到期未解除则在名次表标「待复查」，等级仍为 C */
  nextReviewAt: string
  /** 状态：生效中持续压 C；已解除则不再影响评级 */
  status: VetoStatus
  /** 复核解除日期（YYYY-MM-DD） */
  resolvedAt?: string
  /** 复核人 */
  resolvedBy?: string
  /** 复核结论（现场确认情况、解除依据） */
  resolution?: string
  createdAt: string
  updatedAt: string
}

export const VETO_TYPES: VetoType[] = ['河道内', '山洪沟', '孤树下', '崖底落石区', '陡坡']

/** 各否决类型的现场判定提示，表单内联展示 */
export const VETO_HINTS: Record<VetoType, string> = {
  河道内: '位于常水位河道或滩地内，暴雨时无法及时撤离。',
  山洪沟: '处于汇水沟口，短时强降雨易形成山洪直冲营位。',
  孤树下: '孤立高树下扎营，雷击与断枝落枝风险不可控。',
  崖底落石区: '崖壁正下方，存在落石历史痕迹或新鲜碎屑。',
  陡坡: '坡度超出营地允许范围，帐篷无法稳定铺设。'
}

/** 记录是否仍在生效（未复核解除）。 */
export function isVetoActive(v: RiskVeto): boolean {
  return v.status !== 'resolved'
}

/** 复查日期是否已到（含当天）；已解除的记录不再算到期。 */
export function isVetoDue(v: RiskVeto, today: string = todayIso()): boolean {
  return isVetoActive(v) && !!v.nextReviewAt && v.nextReviewAt <= today
}
