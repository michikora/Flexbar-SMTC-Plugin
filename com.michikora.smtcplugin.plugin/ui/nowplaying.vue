<template>
  <div class="pa-2">
    <v-switch
      v-model="modelValue.data.autoBgColor"
      :label="$t('NowPlaying.UI.autoBgColor')"
      density="compact"
      color="primary"
      hide-details
      class="mb-2"
      @update:modelValue="emitUpdate"
    ></v-switch>
    <v-text-field
      v-if="!modelValue.data.autoBgColor"
      v-model="modelValue.data.manualBgColor"
      :label="$t('NowPlaying.UI.manualBgColor')"
      type="color"
      density="compact"
      variant="outlined"
      class="mb-4"
      @update:modelValue="emitUpdate"
    ></v-text-field>
    
    <v-switch
      v-model="modelValue.data.autoProgressFillColor"
      :label="$t('NowPlaying.UI.autoProgressFillColor')"
      density="compact"
      color="primary"
      hide-details
      class="mb-2"
      @update:modelValue="emitUpdate"
    ></v-switch>
    <v-text-field
      v-if="!modelValue.data.autoProgressFillColor"
      v-model="modelValue.data.manualProgressFillColor"
      :label="$t('NowPlaying.UI.manualProgressFillColor')"
      type="color"
      density="compact"
      variant="outlined"
      class="mb-2"
      @update:modelValue="emitUpdate"
    ></v-text-field>
    <v-text-field
      v-if="!modelValue.data.autoProgressFillColor"
      v-model="modelValue.data.manualProgressBgColor"
      :label="$t('NowPlaying.UI.manualProgressBgColor')"
      type="color"
      density="compact"
      variant="outlined"
      class="mb-4"
      @update:modelValue="emitUpdate"
    ></v-text-field>
    
    <v-switch
      v-model="modelValue.data.autoTextColor"
      :label="$t('NowPlaying.UI.autoTextColor')"
      density="compact"
      color="primary"
      hide-details
      class="mb-2"
      @update:modelValue="emitUpdate"
    ></v-switch>
    <v-text-field
      v-if="!modelValue.data.autoTextColor"
      v-model="modelValue.data.manualTextColor"
      :label="$t('NowPlaying.UI.manualTextColor')"
      type="color"
      density="compact"
      variant="outlined"
      class="mb-4"
      @update:modelValue="emitUpdate"
    ></v-text-field>

    <v-text-field
      v-model="modelValue.data.fontMain"
      :label="$t('NowPlaying.UI.fontMain')"
      density="compact"
      variant="outlined"
      class="mb-4"
      @update:modelValue="emitUpdate"
    ></v-text-field>

    <v-text-field
      v-model="modelValue.data.fontTime"
      :label="$t('NowPlaying.UI.fontTime')"
      density="compact"
      variant="outlined"
      @update:modelValue="emitUpdate"
    ></v-text-field>
  </div>
</template>

<script>
export default {
  name: 'NowPlayingSettings',
  props: {
    modelValue: {
      type: Object,
      required: true
    }
  },
  emits: ['update:modelValue'],
  methods: {
    emitUpdate() {
      this.$emit('update:modelValue', this.modelValue);
    },
    initDefaults() {
      if (!this.modelValue.data) {
        this.modelValue.data = {};
      }
      if (this.modelValue.data.autoBgColor === undefined) this.modelValue.data.autoBgColor = true;
      if (this.modelValue.data.autoProgressFillColor === undefined) this.modelValue.data.autoProgressFillColor = true;
      if (this.modelValue.data.autoTextColor === undefined) this.modelValue.data.autoTextColor = true;
      
      if (this.modelValue.data.manualBgColor === undefined) this.modelValue.data.manualBgColor = '#000000';
      if (this.modelValue.data.manualProgressFillColor === undefined) this.modelValue.data.manualProgressFillColor = '#1DB954';
      if (this.modelValue.data.manualProgressBgColor === undefined) this.modelValue.data.manualProgressBgColor = '#404040';
      if (this.modelValue.data.manualTextColor === undefined) this.modelValue.data.manualTextColor = '#FFFFFF';
      
      if (this.modelValue.data.fontMain === undefined) this.modelValue.data.fontMain = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Arial, "Meiryo", "Microsoft YaHei", "PingFang SC", sans-serif';
      if (this.modelValue.data.fontTime === undefined) this.modelValue.data.fontTime = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Arial, "Meiryo", "Microsoft YaHei", "PingFang SC", sans-serif';
    }
  },
  mounted() {
    this.initDefaults();
  }
};
</script>
