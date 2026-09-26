/**
 * 界面状态：风险否决记录的读写、名次表筛选条件、评分页的临时权重。
 * 临时权重放在 store 里，拖权重条时首页与评分页共享同一份实时结果。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, toPlain } from '@/utils/db'
import type { RiskVeto } from '@/types/veto'
import { isVetoActive, isVetoDue, isVetoResolved } from '@/types/veto'
import type { FactorWeights, NormalizeMethod, GradeThresholds } from '@/types/score'
import { DEFAULT_WEIGHTS } from '@/types/score'
import type { AccessMode, SurfaceType } from '@/types/campsite'
import { nowIso, todayIso } from '@/utils/format'

export const useUiStore = defineStore('ui', () => {
  const vetos = ref<RiskVeto[]>([])
  const loadingVetos = ref(false)

  /** 名次表筛选条件 */
  const filterCamp = ref<string>('')
  const filterSurface = ref<SurfaceType | ''>('')
  const filterAccess = ref<AccessMode | ''>('')
  const keyword = ref<string>('')

  /** 评分页拖动中的临时权重（未保存前不落库） */
  const workingWeights = ref<FactorWeights>({ ...DEFAULT_WEIGHTS })
  const workingNormalize = ref<NormalizeMethod>('minmax')
  const workingThresholds = ref<GradeThresholds>({ gradeA: 78, gradeB: 58 })
  const workingSeason = ref<string>('四季通用')
  const dirty = ref(false)

  /** 地图页当前选中的营位 id */
  const focusedSiteId = ref<number | null>(null)

  async function loadVetos(): Promise<void> {
    loadingVetos.value = true
    try {
      vetos.value = await db.vetos.toArray()
    } finally {
      loadingVetos.value = false
    }
  }

  async function addVeto(input: RiskVeto): Promise<number> {
    const now = nowIso()
    const record = toPlain({
      ...input,
      judgedAt: input.judgedAt || todayIso(),
      nextReviewAt: input.nextReviewAt || todayIso(),
      resolution: '',
      reviewer: '',
      resolvedAt: '',
      createdAt: now,
      updatedAt: now
    }) as RiskVeto
    delete record.id
    const id = await db.vetos.add(record)
    await loadVetos()
    return id
  }

  /**
   * 复核解除：由复核人写结论与日期。记录保留在台账里方便回看，
   * 解除后该营位不再被压 C，按当前权重重新参与评级。
   */
  async function resolveVeto(
    id: number,
    payload: { resolution: string; reviewer: string; resolvedAt?: string }
  ): Promise<void> {
    await db.vetos.update(id, {
      resolution: payload.resolution.trim(),
      reviewer: payload.reviewer.trim() || '未署名',
      resolvedAt: payload.resolvedAt || todayIso(),
      updatedAt: nowIso()
    })
    await loadVetos()
  }

  /** 仅在删除营位时级联清理台账；常规「解除」走 resolveVeto 保留记录。 */
  async function removeVeto(id: number): Promise<void> {
    await db.vetos.delete(id)
    await loadVetos()
  }

  /** 某营位仍在生效（未解除）的否决项；已解除记录留在 vetos 台账里但不参与压制。 */
  function activeVetosOf(siteId: number | null | undefined): RiskVeto[] {
    if (siteId == null) return []
    return vetos.value.filter((v) => v.siteId === siteId && isVetoActive(v))
  }

  /** 某营位的全部否决记录（含已解除），台账与多轮复核对比用。 */
  function vetosOf(siteId: number | null | undefined): RiskVeto[] {
    if (siteId == null) return []
    return vetos.value.filter((v) => v.siteId === siteId)
  }

  function isVetoed(siteId: number | null | undefined): boolean {
    return activeVetosOf(siteId).length > 0
  }

  /** 命中生效否决的营位 id 集合，名次表与地图共用。 */
  const vetoedSiteIds = computed<number[]>(() =>
    Array.from(new Set(vetos.value.filter(isVetoActive).map((v) => v.siteId)))
  )

  /** 到了下次复查日期、仍未解除的否决记录。 */
  const dueVetos = computed<RiskVeto[]>(() => {
    const today = todayIso()
    return vetos.value.filter((v) => isVetoDue(v, today))
  })

  /** 待复查营位 id 集合（仍保持 C 级，名次表额外标成「待复查」）。 */
  const pendingReviewSiteIds = computed<number[]>(() =>
    Array.from(new Set(dueVetos.value.map((v) => v.siteId)))
  )

  /** 某营位是否有待复查（复查日已到仍未解除）的否决项。 */
  function isPendingReview(siteId: number | null | undefined): boolean {
    if (siteId == null) return false
    const today = todayIso()
    return vetos.value.some((v) => v.siteId === siteId && isVetoDue(v, today))
  }

  /** 某营位已解除的否决记录，详情页展示复核结论用。 */
  function resolvedVetosOf(siteId: number | null | undefined): RiskVeto[] {
    if (siteId == null) return []
    return vetos.value.filter((v) => v.siteId === siteId && isVetoResolved(v))
  }

  /** 用启用方案覆盖临时权重。 */
  function syncFromProfile(
    weights: FactorWeights,
    normalize: NormalizeMethod,
    thresholds: GradeThresholds,
    season: string
  ): void {
    workingWeights.value = { ...DEFAULT_WEIGHTS, ...weights }
    workingNormalize.value = normalize
    workingThresholds.value = { ...thresholds }
    workingSeason.value = season
    dirty.value = false
  }

  function resetFilters(): void {
    filterCamp.value = ''
    filterSurface.value = ''
    filterAccess.value = ''
    keyword.value = ''
  }

  /** 台账记录总数（含已解除留档）。 */
  const vetoTotal = computed(() => vetos.value.length)

  /** 仍在生效的否决记录数（未解除）。 */
  const activeVetoTotal = computed(() => vetos.value.filter(isVetoActive).length)

  /** 待复查记录数。 */
  const pendingReviewTotal = computed(() => dueVetos.value.length)

  return {
    vetos,
    loadingVetos,
    vetoTotal,
    activeVetoTotal,
    pendingReviewTotal,
    filterCamp,
    filterSurface,
    filterAccess,
    keyword,
    workingWeights,
    workingNormalize,
    workingThresholds,
    workingSeason,
    dirty,
    focusedSiteId,
    vetoedSiteIds,
    dueVetos,
    pendingReviewSiteIds,
    loadVetos,
    addVeto,
    resolveVeto,
    removeVeto,
    vetosOf,
    activeVetosOf,
    resolvedVetosOf,
    isVetoed,
    isPendingReview,
    syncFromProfile,
    resetFilters
  }
})
