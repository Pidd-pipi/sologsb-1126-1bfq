<script setup lang="ts">
/**
 * VetoResolveDialog —— 风险否决的现场复核解除。
 * 由复核人填写结论与日期后解除：记录保留在台账，营位重新按当前权重评级。
 * 被 `/veto`（台账）与 `/sites/:id`（否决记录）复用。
 */
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { RiskVeto } from '@/types/veto'
import { VETO_STATUS_LABEL, vetoStatus } from '@/types/veto'
import { formatDate, todayIso } from '@/utils/format'
import { useUiStore } from '@/stores/uiStore'

const props = defineProps<{
  /** 传入记录时弹窗打开；置 null 关闭 */
  veto: RiskVeto | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const uiStore = useUiStore()

/** 弹窗头部展示的当前状态（未到期 / 待复查） */
const statusLabel = computed(() =>
  props.veto ? VETO_STATUS_LABEL[vetoStatus(props.veto, todayIso())] : ''
)

const form = reactive({
  resolution: '',
  reviewer: '',
  resolvedAt: todayIso()
})
const submitting = ref(false)

watch(
  () => props.veto?.id,
  () => {
    form.resolution = ''
    form.reviewer = ''
    form.resolvedAt = todayIso()
  }
)

async function confirm(): Promise<void> {
  if (!props.veto || typeof props.veto.id !== 'number') return
  if (!form.resolution.trim()) {
    ElMessage.warning('请填写现场复核结论')
    return
  }
  if (!form.resolvedAt) {
    ElMessage.warning('请选择解除日期')
    return
  }
  submitting.value = true
  try {
    await uiStore.resolveVeto(props.veto.id, {
      resolution: form.resolution,
      reviewer: form.reviewer,
      resolvedAt: form.resolvedAt
    })
    ElMessage.success('已解除：该营位恢复按当前权重参与评级，记录留在台账中可回看')
    emit('close')
  } catch (err) {
    ElMessage.error(`解除失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="veto !== null"
    title="现场复核解除"
    width="520px"
    @close="emit('close')"
  >
    <div v-if="veto" class="resolve-meta">
      <p><span>否决类型</span><el-tag type="danger" size="small">{{ veto.type }}</el-tag></p>
      <p>
        <span>当前状态</span>
        <el-tag type="warning" size="small">{{ statusLabel }}</el-tag>
      </p>
      <p><span>判定人 / 日期</span><strong>{{ veto.judge }} · {{ formatDate(veto.judgedAt) }}</strong></p>
      <p><span>下次复查</span><strong>{{ formatDate(veto.nextReviewAt) }}</strong></p>
      <p class="resolve-meta__desc"><span>判定说明</span>{{ veto.description }}</p>
    </div>
    <el-form label-width="86px" @submit.prevent>
      <el-form-item label="复核人" required>
        <el-input
          id="resolve-reviewer"
          v-model="form.reviewer"
          placeholder="现场确认的复核人，如 陈巡"
        />
      </el-form-item>
      <el-form-item label="解除日期" required>
        <el-date-picker
          id="resolve-date"
          v-model="form.resolvedAt"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="复核结论" required>
        <el-input
          id="resolve-conclusion"
          v-model="form.resolution"
          type="textarea"
          :rows="3"
          placeholder="现场确认的隐患处置情况与解除依据"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="confirm">确认解除</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.resolve-meta {
  margin: 0 0 12px;
  padding: 10px 12px;
  background: var(--gb-surface);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.resolve-meta p {
  margin: 0;
  display: flex;
  gap: 10px;
  font-size: 13px;
  align-items: center;
}
.resolve-meta span {
  flex: 0 0 92px;
  color: var(--gb-muted);
  font-size: 12px;
}
.resolve-meta__desc {
  align-items: flex-start !important;
}
.resolve-meta__desc span {
  padding-top: 1px;
}
</style>
