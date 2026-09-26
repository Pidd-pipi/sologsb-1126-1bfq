/**
 * 界面状态：风险否决记录的读写、名次表筛选条件、评分页的临时权重。
 * 临时权重放在 store 里，拖权重条时首页与评分页共享同一份实时结果。
 *
 * 否决记录有完整生命周期：登记后持续压住等级（C）；到了 nextReviewAt 仍未解除的
 * 记为「待复查」；现场确认无问题后由复核人写结论解除（resolveVeto），
 * 记录保留在台账里，但不再影响评级。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, toPlain } from '@/utils/db'
import type { RiskVeto } from '@/types/veto'
import { isVetoActive, isVetoDue } from '@/types/veto'
import type { FactorWeights, NormalizeMethod, GradeThresholds } from '@/types/score'
import { DEFAULT_WEIGHTS } from '@/types/score'
import type { AccessMode, SurfaceType } from '@/types/campsite'
import { nowIso, todayIso } from '@/utils/format'

export interface VetoResolutionInput {
  resolvedBy: string
  resolvedAt: string
  resolution: string
}

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
      status: 'active',
      judgedAt: input.judgedAt || todayIso(),
      createdAt: now,
      updatedAt: now
    }) as RiskVeto
    delete record.id
    delete record.resolvedAt
    delete record.resolvedBy
    delete record.resolution
    const id = await db.vetos.add(record)
    await loadVetos()
    return id
  }

  /**
   * 复核解除：由复核人写结论与日期。记录保留在台账中（status=resolved），
   * 该营位不再被本条否决压级，重新按当前权重参与评级。
   */
  async function resolveVeto(id: number, input: VetoResolutionInput): Promise<void> {
    await db.vetos.update(id, {
      status: 'resolved',
      resolvedBy: input.resolvedBy.trim() || '未署名',
      resolvedAt: input.resolvedAt || todayIso(),
      resolution: input.resolution.trim(),
      updatedAt: nowIso()
    })
    await loadVetos()
  }

  /** 仅在删除营位时级联清理台账，业务流程中不提供硬删除入口。 */
  async function removeVeto(id: number): Promise<void> {
    await db.vetos.delete(id)
    await loadVetos()
  }

  /** 某营位的全部否决记录（含已解除，台账回看用）。 */
  function vetosOf(siteId: number | null | undefined): RiskVeto[] {
    if (siteId == null) return []
    return vetos.value.filter((v) => v.siteId === siteId)
  }

  /** 某营位仍在生效的否决项。 */
  function activeVetosOf(siteId: number | null | undefined): RiskVeto[] {
    return vetosOf(siteId).filter(isVetoActive)
  }

  /** 某营位已到复查日期、仍未解除的否决项。 */
  function dueVetosOf(siteId: number | null | undefined): RiskVeto[] {
    return vetosOf(siteId).filter((v) => isVetoDue(v))
  }

  function isVetoed(siteId: number | null | undefined): boolean {
    return activeVetosOf(siteId).length > 0
  }

  /** 命中生效否决的营位 id 集合，名次表与地图共用。 */
  const vetoedSiteIds = computed<number[]>(() =>
    Array.from(new Set(vetos.value.filter(isVetoActive).map((v) => v.siteId)))
  )

  /** 已到复查日期、仍压着 C 级的营位 id 集合（名次表标「待复查」）。 */
  const reviewDueSiteIds = computed<number[]>(() =>
    Array.from(new Set(vetos.value.filter((v) => isVetoDue(v)).map((v) => v.siteId)))
  )

  const activeVetos = computed(() => vetos.value.filter(isVetoActive))
  const resolvedVetos = computed(() => vetos.value.filter((v) => !isVetoActive(v)))
  const dueVetos = computed(() => vetos.value.filter((v) => isVetoDue(v)))

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

  /** 台账总条数（含已解除，方便回看）。 */
  const vetoTotal = computed(() => vetos.value.length)
  /** 仍在生效的否决条数。 */
  const activeVetoTotal = computed(() => activeVetos.value.length)

  return {
    vetos,
    loadingVetos,
    activeVetos,
    resolvedVetos,
    dueVetos,
    vetoTotal,
    activeVetoTotal,
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
    reviewDueSiteIds,
    loadVetos,
    addVeto,
    resolveVeto,
    removeVeto,
    vetosOf,
    activeVetosOf,
    dueVetosOf,
    isVetoed,
    syncFromProfile,
    resetFilters
  }
})
