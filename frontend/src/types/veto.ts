/**
 * RiskVeto（风险否决项）—— 登记后该营位等级被压到 C，并按下一次复查日期进入「待复查」。
 * 属于「一票否决」类硬约束，与得分体系解耦；现场复核无问题后由复核人写结论解除，
 * 解除后营位按当前权重重新评级，记录本身仍留在台账中可回看。
 */

/** 否决类型 */
export type VetoType = '河道内' | '山洪沟' | '孤树下' | '崖底落石区' | '陡坡'

/** 否决记录生命周期状态：未到期 / 待复查（复查日已到仍未解除）/ 已解除 */
export type VetoStatus = 'active' | 'pending-review' | 'resolved'

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
  /** 下次复查日期（YYYY-MM-DD）：到了日期仍未解除则保持 C 级并在名次表标成待复查 */
  nextReviewAt: string
  /** 复核结论（现场确认无问题后填写）；填写后该记录视为已解除 */
  resolution?: string
  /** 复核人 */
  reviewer?: string
  /** 解除日期（YYYY-MM-DD） */
  resolvedAt?: string
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

/** 状态展示文案（台账、详情、名次表共用） */
export const VETO_STATUS_LABEL: Record<VetoStatus, string> = {
  active: '监控中',
  'pending-review': '待复查',
  resolved: '已解除'
}

/** 登记时的默认复查间隔（自然日） */
export const DEFAULT_REVIEW_DAYS = 30

/** 已解除：复核人写过结论与解除日期。 */
export function isVetoResolved(v: RiskVeto | undefined | null): boolean {
  return !!v && !!v.resolvedAt && !!v.resolution?.trim()
}

/** 仍在压制评级的否决项：未解除。 */
export function isVetoActive(v: RiskVeto | undefined | null): boolean {
  return !!v && !isVetoResolved(v)
}

/**
 * 待复查：未解除且到了下次复查日期（nextReviewAt <= today）。
 * 没填复查日期的旧记录不自动转待复查，仍按「监控中」继续压 C。
 */
export function isVetoDue(v: RiskVeto | undefined | null, today: string): boolean {
  return (
    !!v && !isVetoResolved(v) && !!v.nextReviewAt && v.nextReviewAt <= today
  )
}

/** 单条记录的生命周期状态。 */
export function vetoStatus(v: RiskVeto | undefined | null, today: string): VetoStatus {
  if (!v || isVetoResolved(v)) return 'resolved'
  return isVetoDue(v, today) ? 'pending-review' : 'active'
}
