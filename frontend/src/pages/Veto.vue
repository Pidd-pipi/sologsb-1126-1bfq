<script setup lang="ts">
/**
 * `/veto` 风险否决登记 —— 选营位与否决类型、填说明与下次复查日期，
 * 提交后名次表与地图同步更新；复查日到期仍未解除的记录标成「待复查」，
 * 现场确认无问题后由复核人写结论解除（记录留在台账）。
 * 消费 RiskVeto、Campsite；复用 <GradeBadge>、<VetoResolveDialog>。
 */
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import GradeBadge from '@/components/common/GradeBadge.vue'
import VetoResolveDialog from '@/components/common/VetoResolveDialog.vue'
import { useSiteStore } from '@/stores/siteStore'
import { useProfileStore } from '@/stores/profileStore'
import { useUiStore } from '@/stores/uiStore'
import { useRanking } from '@/hooks/useRanking'
import { VETO_TYPES, VETO_HINTS, VETO_STATUS_LABEL, vetoStatus } from '@/types/veto'
import type { RiskVeto, VetoType } from '@/types/veto'
import { addDaysIso, formatDate, todayIso } from '@/utils/format'

const router = useRouter()
const siteStore = useSiteStore()
const profileStore = useProfileStore()
const uiStore = useUiStore()

const today = todayIso()

const { scoreOf } = useRanking({
  sites: () => siteStore.list,
  factorOf: (id: number) => siteStore.latestFactor(id),
  weights: () => profileStore.activeWeights,
  normalize: () => profileStore.activeProfile?.normalize ?? 'minmax',
  thresholds: () => profileStore.activeProfile?.thresholds ?? { gradeA: 78, gradeB: 58 },
  vetoedIds: () => uiStore.vetoedSiteIds,
  pendingReviewIds: () => uiStore.pendingReviewSiteIds
})

const form = reactive({
  siteId: null as number | null,
  type: '山洪沟' as VetoType,
  description: '',
  judge: '',
  judgedAt: today,
  nextReviewAt: addDaysIso(today, 30)
})

const submitting = ref(false)

const siteOptions = computed(() =>
  siteStore.list
    .filter((s): s is typeof s & { id: number } => typeof s.id === 'number')
    .map((s) => ({
      value: s.id,
      label: `${s.code} · ${s.name}（${s.campName}）`,
      vetoed: uiStore.isVetoed(s.id),
      pending: uiStore.isPendingReview(s.id)
    }))
)

const selectedSite = computed(() =>
  form.siteId == null ? null : siteStore.byId(form.siteId)
)

const selectedRow = computed(() =>
  form.siteId == null ? null : scoreOf(form.siteId)
)

const selectedVetos = computed(() => uiStore.activeVetosOf(form.siteId))

/** 全部否决记录（含已解除留档），附带营位信息与状态，便于一览 */
const vetoLedger = computed(() =>
  uiStore.vetos
    .map((v) => {
      const site = siteStore.byId(v.siteId)
      const row = scoreOf(v.siteId)
      const status = vetoStatus(v, today)
      return {
        ...v,
        status,
        statusLabel: VETO_STATUS_LABEL[status],
        siteCode: site?.code ?? '—',
        siteName: site?.name ?? '营位已删除',
        campName: site?.campName ?? '—',
        grade: row?.grade ?? 'C',
        total: row?.total ?? 0,
        siteVetoed: row?.vetoed ?? false,
        sitePendingReview: row?.pendingReview ?? false
      }
    })
    .sort((a, b) => {
      // 待复查优先，其次按判定日期倒序
      if ((a.status === 'pending-review') !== (b.status === 'pending-review')) {
        return a.status === 'pending-review' ? -1 : 1
      }
      return a.judgedAt < b.judgedAt ? 1 : -1
    })
)

const ledgerStats = computed(() => ({
  total: uiStore.vetoTotal,
  active: uiStore.activeVetoTotal,
  pending: uiStore.pendingReviewTotal
}))

const resolvingVeto = ref<RiskVeto | null>(null)

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
    ElMessage.warning('请选择下次复查日期')
    return
  }
  if (form.nextReviewAt < form.judgedAt) {
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
      judgedAt: form.judgedAt || today,
      nextReviewAt: form.nextReviewAt,
      createdAt: '',
      updatedAt: ''
    })
    ElMessage.success('否决项已登记：等级保持 C 级，到期未解除将在名次表标为待复查')
    form.description = ''
    form.judge = ''
  } catch (err) {
    ElMessage.error(`登记失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    submitting.value = false
  }
}

function openResolve(row: RiskVeto): void {
  resolvingVeto.value = row
}

/** 已解除记录在台账行中弱化 */
function ledgerRowClass({ row }: { row: { status: string } }): string {
  return row.status === 'resolved' ? 'resolved-row' : ''
}

function focusSite(id: number | undefined): void {
  if (typeof id !== 'number') return
  form.siteId = id
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head__title">
        <h1>风险否决登记</h1>
        <p>
          河道内、山洪沟、孤树下、崖底落石区与陡坡属于「一票否决」类硬约束：
          登记后该营位综合等级被压到 C 级，并约定下次复查日期；到期仍未解除的会在名次表标成
          「待复查」，现场确认无问题后由复核人写结论解除，营位再按当前权重参与评级。
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
      title="否决与得分解耦 · 复查解除留台账"
      description="否决记录不参与加权求和，而是在得分算出后短路为 C。到期记录不会自动失效，需复核人现场确认并填写结论、日期后解除；解除后的记录仍保留在台账中，等级随即按当前权重重评。"
    />

    <div class="veto-layout">
      <section class="panel">
        <div class="panel__head">
          <h2>登记否决项</h2>
        </div>
        <el-form label-width="110px" @submit.prevent>
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
                <el-tag
                  v-if="opt.pending"
                  type="warning"
                  size="small"
                  style="float: right"
                >
                  待复查
                </el-tag>
                <el-tag v-else-if="opt.vetoed" type="danger" size="small" style="float: right">
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
            />
          </el-form-item>
          <el-form-item label="下次复查日期" required>
            <el-date-picker
              id="veto-review-date"
              v-model="form.nextReviewAt"
              type="date"
              value-format="YYYY-MM-DD"
              :disabled-date="(d: Date) => form.judgedAt ? d < new Date(`${form.judgedAt}T00:00:00`) : false"
              style="width: 100%"
            />
            <span class="form-tip">到了日期仍未解除：保持 C 级并在名次表标成「待复查」</span>
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
              <span>生效否决</span>
              <strong>{{ selectedVetos.length }} 条</strong>
            </div>
          </div>
          <div v-if="selectedVetos.length" class="preview-veto">
            <el-tag
              v-for="v in selectedVetos"
              :key="v.id"
              :type="vetoStatus(v, today) === 'pending-review' ? 'warning' : 'danger'"
              size="small"
              class="mr6"
            >
              {{ v.type }}
              <span class="preview-veto__date">复查 {{ formatDate(v.nextReviewAt) }}</span>
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
        <p v-else class="panel__hint">请先从左侧选择营位，提交前可在此确认该营位的基础条件与否决记录。</p>
      </section>
    </div>

    <section class="panel">
      <div class="panel__head">
        <h2>否决台账</h2>
        <span class="weight-note">
          共 {{ ledgerStats.total }} 条 · 生效 {{ ledgerStats.active }} 条 · 待复查
          {{ ledgerStats.pending }} 条（含已解除留档）
        </span>
      </div>
      <el-table
        v-if="vetoLedger.length"
        :data="vetoLedger"
        size="small"
        border
        stripe
        :row-class-name="ledgerRowClass"
      >
        <el-table-column label="营位" min-width="190">
          <template #default="{ row }">
            <el-link type="primary" underline="never" @click="focusSite(row.siteId)">
              {{ row.siteCode }} · {{ row.siteName }}
            </el-link>
            <div class="cell-sub">{{ row.campName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="否决类型" width="118">
          <template #default="{ row }">
            <el-tag :type="row.status === 'resolved' ? 'info' : 'danger'" size="small">
              {{ row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="说明 / 复核结论" min-width="280">
          <template #default="{ row }">
            <span>{{ row.description }}</span>
            <div v-if="row.resolution" class="cell-sub resolution-text">
              <el-tag type="success" size="small" effect="plain">复核结论</el-tag>
              {{ row.resolution }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="判定人 / 复核人" width="130">
          <template #default="{ row }">
            <div>{{ row.judge }}</div>
            <div v-if="row.reviewer" class="cell-sub">复核 {{ row.reviewer }}</div>
          </template>
        </el-table-column>
        <el-table-column label="判定 / 复查" width="190">
          <template #default="{ row }">
            <div>判定 {{ formatDate(row.judgedAt) }}</div>
            <div class="cell-sub" :class="{ 'review-due': row.status === 'pending-review' }">
              复查 {{ formatDate(row.nextReviewAt) || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态 / 解除日期" width="128">
          <template #default="{ row }">
            <el-tag
              :type="
                row.status === 'pending-review'
                  ? 'warning'
                  : row.status === 'resolved'
                    ? 'success'
                    : 'danger'
              "
              size="small"
              effect="plain"
            >
              {{ row.statusLabel }}
            </el-tag>
            <div v-if="row.resolvedAt" class="cell-sub">{{ formatDate(row.resolvedAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="当前等级" width="170">
          <template #default="{ row }">
            <GradeBadge
              :grade="row.grade"
              :score="row.total"
              :vetoed="row.siteVetoed"
              :pending-review="row.sitePendingReview"
              size="small"
              :show-label="false"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="focusSite(row.siteId)">定位</el-button>
            <el-button
              v-if="row.status !== 'resolved'"
              size="small"
              text
              type="warning"
              @click="openResolve(row)"
            >
              复核解除
            </el-button>
            <span v-else class="cell-sub">已留档</span>
          </template>
        </el-table-column>
      </el-table>
      <p v-else class="panel__hint">暂无否决记录。登记后名次表与地图会立即同步，到期未解除将标为待复查。</p>
    </section>

    <VetoResolveDialog :veto="resolvingVeto" @close="resolvingVeto = null" />
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
.form-tip {
  font-size: 11px;
  color: var(--gb-muted);
  line-height: 1.5;
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
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.preview-veto__date {
  margin-left: 4px;
  opacity: 0.85;
}
.cell-sub {
  font-size: 11px;
  color: var(--gb-muted);
}
.review-due {
  color: #b45309;
  font-weight: 600;
}
.resolution-text {
  margin-top: 3px;
  line-height: 1.5;
}
.mr6 {
  margin-right: 6px;
}
</style>

<style>
/* 台账中已解除留档行整体弱化，scoped 对 el-table 行类不生效，写全局 */
.el-table .resolved-row {
  opacity: 0.62;
}
</style>
