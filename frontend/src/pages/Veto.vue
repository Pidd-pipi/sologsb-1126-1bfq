<script setup lang="ts">
/**
 * `/veto` 风险否决登记 —— 选营位与否决类型、填说明并约定下次复查日期，
 * 提交后名次表与地图同步更新；到期未解除的记录在名次表标「待复查」（仍为 C 级），
 * 现场确认无问题后由复核人写结论与日期解除，营位重新参与评级，记录留在台账中回看。
 * 消费 RiskVeto、Campsite；复用 <GradeBadge>。
 */
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import GradeBadge from '@/components/common/GradeBadge.vue'
import { useSiteStore } from '@/stores/siteStore'
import { useProfileStore } from '@/stores/profileStore'
import { useUiStore } from '@/stores/uiStore'
import { useRanking } from '@/hooks/useRanking'
import { VETO_TYPES, VETO_HINTS, isVetoActive, isVetoDue } from '@/types/veto'
import type { VetoType, RiskVeto } from '@/types/veto'
import { formatDate, todayIso, defaultReviewDate } from '@/utils/format'

const router = useRouter()
const siteStore = useSiteStore()
const profileStore = useProfileStore()
const uiStore = useUiStore()

const { scoreOf } = useRanking({
  sites: () => siteStore.list,
  factorOf: (id: number) => siteStore.latestFactor(id),
  weights: () => profileStore.activeWeights,
  normalize: () => profileStore.activeProfile?.normalize ?? 'minmax',
  thresholds: () => profileStore.activeProfile?.thresholds ?? { gradeA: 78, gradeB: 58 },
  vetoedIds: () => uiStore.vetoedSiteIds,
  reviewDueIds: () => uiStore.reviewDueSiteIds
})

const form = reactive({
  siteId: null as number | null,
  type: '山洪沟' as VetoType,
  description: '',
  judge: '',
  judgedAt: todayIso(),
  nextReviewAt: defaultReviewDate()
})

const submitting = ref(false)

const siteOptions = computed(() =>
  siteStore.list
    .filter((s): s is typeof s & { id: number } => typeof s.id === 'number')
    .map((s) => ({
      value: s.id,
      label: `${s.code} · ${s.name}（${s.campName}）`,
      vetoed: uiStore.isVetoed(s.id)
    }))
)

const selectedSite = computed(() =>
  form.siteId == null ? null : siteStore.byId(form.siteId)
)

const selectedRow = computed(() =>
  form.siteId == null ? null : scoreOf(form.siteId)
)

const selectedVetos = computed(() => uiStore.activeVetosOf(form.siteId))

/** 判定日期变化后，复查日期若仍停留在旧基准上则顺延（默认判定日后 30 天）。 */
function syncReviewDate(): void {
  form.nextReviewAt = defaultReviewDate(form.judgedAt || todayIso())
}

/** 全部否决记录（含已解除），附带营位信息，便于台账回看 */
const vetoLedger = computed(() =>
  uiStore.vetos
    .map((v) => {
      const site = siteStore.byId(v.siteId)
      const row = scoreOf(v.siteId)
      const active = isVetoActive(v)
      const due = isVetoDue(v)
      return {
        ...v,
        siteCode: site?.code ?? '—',
        siteName: site?.name ?? '营位已删除',
        campName: site?.campName ?? '—',
        active,
        due,
        grade: row?.grade ?? 'C',
        total: row?.total ?? 0
      }
    })
    .sort((a, b) => {
      // 生效中的排前面，组内按判定日期倒序
      if (a.active !== b.active) return a.active ? -1 : 1
      return a.judgedAt < b.judgedAt ? 1 : -1
    })
)

const activeCount = computed(() => vetoLedger.value.filter((v) => v.active).length)
const dueCount = computed(() => vetoLedger.value.filter((v) => v.due).length)
const resolvedCount = computed(() => vetoLedger.value.filter((v) => !v.active).length)

async function submit(): Promise<void> {
  if (form.siteId == null) {
    ElMessage.warning('请选择要否决的营位')
    return
  }
  if (!form.description.trim()) {
    ElMessage.warning('请填写否决说明，便于复核')
    return
  }
  if (!form.nextReviewAt) {
    ElMessage.warning('请约定下次复查日期')
    return
  }
  if (form.nextReviewAt < (form.judgedAt || todayIso())) {
    ElMessage.warning('下次复查日期不能早于判定日期')
    return
  }
  submitting.value = true
  try {
    await uiStore.addVeto({
      siteId: form.siteId,
      type: form.type,
      description: form.description.trim(),
      judge: form.judge.trim() || '未署名',
      judgedAt: form.judgedAt || todayIso(),
      nextReviewAt: form.nextReviewAt,
      status: 'active',
      createdAt: '',
      updatedAt: ''
    })
    ElMessage.success('否决项已登记：名次表压到 C 级，到期未解除将标记为待复查')
    form.description = ''
    form.judge = ''
  } catch (err) {
    ElMessage.error(`登记失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    submitting.value = false
  }
}

/* ------------------------------ 复核解除 ------------------------------ */
const resolveDialogVisible = ref(false)
const resolvingVeto = ref<RiskVeto | null>(null)
const resolveForm = reactive({
  resolvedBy: '',
  resolvedAt: todayIso(),
  resolution: ''
})
const resolving = ref(false)

function openResolve(veto: RiskVeto): void {
  resolvingVeto.value = veto
  resolveForm.resolvedBy = veto.judge ?? ''
  resolveForm.resolvedAt = todayIso()
  resolveForm.resolution = ''
  resolveDialogVisible.value = true
}

async function confirmResolve(): Promise<void> {
  if (!resolvingVeto.value?.id) return
  if (!resolveForm.resolution.trim()) {
    ElMessage.warning('请填写现场复核结论')
    return
  }
  if (!resolveForm.resolvedAt) {
    ElMessage.warning('请填写复核日期')
    return
  }
  resolving.value = true
  try {
    await uiStore.resolveVeto(resolvingVeto.value.id, {
      resolvedBy: resolveForm.resolvedBy,
      resolvedAt: resolveForm.resolvedAt,
      resolution: resolveForm.resolution
    })
    resolveDialogVisible.value = false
    ElMessage.success('已解除该否决项，营位按当前权重重新参与评级')
  } finally {
    resolving.value = false
  }
}

function focusSite(id: number | undefined): void {
  if (typeof id !== 'number') return
  form.siteId = id
}

/** 待复查行琥珀底，已解除行弱化 */
function ledgerRowClass({ row }: { row: { active: boolean; due: boolean } }): string {
  if (!row.active) return 'resolved-row'
  return row.due ? 'review-row' : ''
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head__title">
        <h1>风险否决登记</h1>
        <p>
          河道内、山洪沟、孤树下、崖底落石区与陡坡属于「一票否决」类硬约束：
          登记后该营位在名次表与地图上立即标红，综合等级被压到 C 级。
          请同时约定下次复查日期：到期仍未解除会在名次表标「待复查」（等级保持 C），
          现场确认无问题后由复核人写结论与日期解除，营位再按当前权重参与评级。
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/')">返回名次表</el-button>
        <el-button @click="router.push('/map')">地图视图</el-button>
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="否决与得分解耦 · 到期复查 · 复核解除"
      description="否决记录不参与加权求和，而是在得分算出后做短路处理：生效中的记录把等级直接压到 C；复查日期到期后仍保持 C 级并标记为待复查；只有复核人写结论解除后，等级才按当前权重重算。已解除的记录保留在台账中可随时回看。"
    />

    <div class="veto-layout">
      <section class="panel">
        <div class="panel__head">
          <h2>登记否决项</h2>
        </div>
        <el-form label-width="100px" @submit.prevent>
          <el-form-item label="营位">
            <el-select
              id="veto-site"
              v-model="form.siteId"
              placeholder="选择要否决的营位"
              filterable
              style="width: 100%"
            >
              <el-option
                v-for="opt in siteOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              >
                <span>{{ opt.label }}</span>
                <el-tag v-if="opt.vetoed" type="danger" size="small" style="float: right">
                  已否决
                </el-tag>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="否决类型">
            <el-select id="veto-type" v-model="form.type" style="width: 100%">
              <el-option v-for="t in VETO_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="判定人">
            <el-input id="veto-judge" v-model="form.judge" placeholder="如 周勘" />
          </el-form-item>
          <el-form-item label="判定日期">
            <el-date-picker
              id="veto-date"
              v-model="form.judgedAt"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
              @change="syncReviewDate"
            />
          </el-form-item>
          <el-form-item label="下次复查">
            <el-date-picker
              id="veto-review-date"
              v-model="form.nextReviewAt"
              type="date"
              value-format="YYYY-MM-DD"
              :disabled-date="(d: Date) => form.judgedAt ? d < new Date(`${form.judgedAt}T00:00:00`) : false"
              style="width: 100%"
            />
            <span class="weight-note">到期未解除：名次表标「待复查」，等级仍保持 C</span>
          </el-form-item>
          <el-form-item label="说明">
            <el-input
              id="veto-desc"
              v-model="form.description"
              type="textarea"
              :rows="3"
              :placeholder="VETO_HINTS[form.type]"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="danger" :loading="submitting" @click="submit">提交否决</el-button>
            <el-button
              @click="
                () => {
                  form.siteId = null
                  form.description = ''
                  form.judge = ''
                }
              "
            >
              清空
            </el-button>
          </el-form-item>
        </el-form>

        <el-divider content-position="left">判定提示</el-divider>
        <ul class="hint-list">
          <li v-for="t in VETO_TYPES" :key="t">
            <el-tag size="small" type="danger" effect="plain">{{ t }}</el-tag>
            <span>{{ VETO_HINTS[t] }}</span>
          </li>
        </ul>
      </section>

      <section class="panel">
        <div class="panel__head">
          <h2>选中营位预览</h2>
          <GradeBadge
            v-if="selectedRow"
            :grade="selectedRow.grade"
            :score="selectedRow.total"
            :vetoed="selectedVetos.length > 0"
            :pending-review="selectedRow.pendingReview"
          />
        </div>
        <template v-if="selectedSite">
          <div class="preview-list">
            <div class="preview-item">
              <span>营位</span>
              <strong>{{ selectedSite.code }} · {{ selectedSite.name }}</strong>
            </div>
            <div class="preview-item">
              <span>所属营地</span>
              <strong>{{ selectedSite.campName }}</strong>
            </div>
            <div class="preview-item">
              <span>地表 / 容量</span>
              <strong>{{ selectedSite.surface }} · {{ selectedSite.tentCapacity }} 帐</strong>
            </div>
            <div class="preview-item">
              <span>坡度 / 海拔</span>
              <strong>{{ selectedSite.slope }}° · {{ selectedSite.elevation }} m</strong>
            </div>
            <div class="preview-item">
              <span>现有否决</span>
              <strong>{{ selectedVetos.length }} 条</strong>
            </div>
          </div>
          <div v-if="selectedVetos.length" class="preview-veto">
            <el-tag
              v-for="v in selectedVetos"
              :key="v.id"
              :type="isVetoDue(v) ? 'warning' : 'danger'"
              size="small"
              class="mr6"
            >
              {{ v.type }}{{ isVetoDue(v) ? ' · 待复查' : '' }}
            </el-tag>
            <p class="panel__hint">{{ selectedVetos.map((v) => v.description).join(' ｜ ') }}</p>
          </div>
          <el-button
            size="small"
            type="primary"
            plain
            style="margin-top: 10px"
            @click="router.push(`/sites/${selectedSite.id}`)"
          >
            打开营位详情
          </el-button>
        </template>
        <p v-else class="panel__hint">请先从左侧选择营位，提交前可在此确认该营位的基础条件与已有的否决记录。</p>
      </section>
    </div>

    <section class="panel">
      <div class="panel__head">
        <h2>否决台账</h2>
        <span class="weight-note">
          共 {{ vetoLedger.length }} 条 · 生效 {{ activeCount }}（待复查 {{ dueCount }}）· 已解除
          {{ resolvedCount }}
        </span>
      </div>
      <el-table v-if="vetoLedger.length" :data="vetoLedger" size="small" border stripe :row-class-name="ledgerRowClass">
        <el-table-column label="状态" width="104">
          <template #default="{ row }">
            <el-tag v-if="!row.active" type="success" size="small">已解除</el-tag>
            <el-tag v-else-if="row.due" type="warning" size="small">待复查</el-tag>
            <el-tag v-else type="danger" size="small">生效中</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="营位" min-width="180">
          <template #default="{ row }">
            <el-link type="primary" underline="never" @click="focusSite(row.siteId)">
              {{ row.siteCode }} · {{ row.siteName }}
            </el-link>
            <div class="cell-sub">{{ row.campName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="否决类型" width="112">
          <template #default="{ row }">
            <el-tag :type="row.active ? 'danger' : 'info'" size="small">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="判定说明" min-width="220" />
        <el-table-column label="判定人 / 日期" width="132">
          <template #default="{ row }">
            <div>{{ row.judge }}</div>
            <div class="cell-sub">{{ formatDate(row.judgedAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="下次复查" width="118">
          <template #default="{ row }">
            <span :class="{ 'due-date': row.due }">{{ formatDate(row.nextReviewAt) }}</span>
            <div v-if="row.due" class="cell-sub due-date">已到期</div>
          </template>
        </el-table-column>
        <el-table-column label="复核解除" min-width="240">
          <template #default="{ row }">
            <template v-if="row.active">
              <span class="muted">现场确认后由复核人写结论解除</span>
            </template>
            <template v-else>
              <div>{{ row.resolvedBy }} · {{ formatDate(row.resolvedAt) }}</div>
              <div class="cell-sub">{{ row.resolution }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="当前等级" width="150">
          <template #default="{ row }">
            <GradeBadge
              :grade="row.grade"
              :score="row.total"
              :vetoed="row.active"
              :pending-review="row.due"
              size="small"
              :show-label="false"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="focusSite(row.siteId)">定位</el-button>
            <el-button
              v-if="row.active"
              size="small"
              text
              :type="row.due ? 'warning' : 'danger'"
              @click="openResolve(row)"
            >
              复核解除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <p v-else class="panel__hint">暂无否决记录。登记后名次表与地图会立即同步标红。</p>
    </section>

    <el-dialog v-model="resolveDialogVisible" title="现场复核解除" width="520px">
      <el-alert
        v-if="resolvingVeto"
        type="info"
        :closable="false"
        show-icon
        :title="`${resolvingVeto.type} · 判定于 ${formatDate(resolvingVeto.judgedAt)}（复查日 ${formatDate(resolvingVeto.nextReviewAt)}）`"
        :description="resolvingVeto.description"
        style="margin-bottom: 14px"
      />
      <el-form label-width="92px" @submit.prevent>
        <el-form-item label="复核人">
          <el-input id="resolve-by" v-model="resolveForm.resolvedBy" placeholder="现场确认的复核人，如 周勘" />
        </el-form-item>
        <el-form-item label="复核日期">
          <el-date-picker
            id="resolve-date"
            v-model="resolveForm.resolvedAt"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="复核结论">
          <el-input
            id="resolve-note"
            v-model="resolveForm.resolution"
            type="textarea"
            :rows="3"
            placeholder="现场确认情况与解除依据，如：已清理危枝、警戒期无落石，确认恢复评级"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resolveDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="resolving" @click="confirmResolve">
          确认解除，恢复评级
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.veto-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 1080px) {
  .veto-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
.hint-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.hint-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--gb-muted);
  line-height: 1.6;
}
.preview-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preview-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  font-size: 13px;
  background: var(--gb-surface);
  border-radius: 8px;
}
.preview-item span {
  color: var(--gb-muted);
}
.preview-veto {
  margin-top: 10px;
}
.cell-sub {
  font-size: 11px;
  color: var(--gb-muted);
}
.due-date {
  color: #d97706;
  font-weight: 600;
}
.mr6 {
  margin-right: 6px;
}
</style>
