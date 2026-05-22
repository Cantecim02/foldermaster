import { Feather } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { translations } from "../i18n";
import { AppTheme } from "../theme";
import { AppFile, FileType } from "../types";
import { getAvailableOutputs } from "../services/conversionTypes";

type Props = {
  files: AppFile[];
  inputType: FileType;
  outputType: FileType;
  isConverting: boolean;
  theme: AppTheme;
  labels: typeof translations.en;
  onSelectFiles: () => void;
  onRemoveFile: (uri: string) => void;
  onRenameFile: (file: AppFile) => void;
  onClearFiles: () => void;
  onOutputTypeChange: (type: FileType) => void;
  onConvert: () => void;
};

export function ConversionForm(props: Props) {
  const {
    files,
    inputType,
    outputType,
    isConverting,
    theme,
    labels,
    onSelectFiles,
    onRemoveFile,
    onRenameFile,
    onClearFiles,
    onOutputTypeChange,
    onConvert
  } = props;

  const availableOutputs = getAvailableOutputs(inputType);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity
        style={[styles.fileButton, { backgroundColor: theme.colors.primary }]}
        onPress={onSelectFiles}
      >
        <Feather name="file-text" size={20} color="#fff" />
        <Text style={styles.fileButtonText}>
          {files.length > 0 ? labels.changeFiles : labels.selectFiles}
        </Text>
      </TouchableOpacity>

      <View style={styles.fileList}>
        <Text style={[styles.label, { color: theme.colors.muted }]}>
          {labels.selectedFiles} ({files.length})
        </Text>
        {files.slice(0, 5).map((file) => (
          <View key={file.uri} style={[styles.fileRow, { borderColor: theme.colors.border }]}>
            <Text
              numberOfLines={1}
              style={[styles.fileName, { color: theme.colors.text }]}
            >
              {file.name}
            </Text>
            <TouchableOpacity
              accessibilityLabel={labels.renameFile}
              style={[styles.editButton, { backgroundColor: theme.colors.surfaceAlt }]}
              onPress={() => onRenameFile(file)}
            >
              <Feather name="edit-3" size={15} color={theme.colors.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={labels.removeFile}
              style={[styles.removeButton, { backgroundColor: theme.colors.dangerSoft }]}
              onPress={() => onRemoveFile(file.uri)}
            >
              <Feather name="x" size={16} color={theme.colors.danger} />
            </TouchableOpacity>
          </View>
        ))}
        {files.length > 0 ? (
          <TouchableOpacity
            style={[styles.clearButton, { borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft }]}
            onPress={onClearFiles}
          >
            <Feather name="trash-2" size={15} color={theme.colors.danger} />
            <Text style={[styles.clearText, { color: theme.colors.danger }]}>
              {labels.clearSelectedFiles}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.row}>
        <View style={styles.pickerGroup}>
          <Text style={[styles.label, { color: theme.colors.muted }]}>{labels.detectedType}</Text>
          <View style={[styles.detectedBox, { borderColor: theme.colors.border }]}>
            <Text style={[styles.detectedText, { color: theme.colors.text }]}>
              {files.length > 0 ? inputType.toUpperCase() : labels.waitingForFile}
            </Text>
          </View>
        </View>

        <View style={styles.pickerGroup}>
          <Text style={[styles.label, { color: theme.colors.muted }]}>{labels.outputType}</Text>
          <View style={[styles.pickerShell, { borderColor: theme.colors.border }]}>
            <Picker
              dropdownIconColor={theme.colors.text}
              itemStyle={{ color: theme.colors.text }}
              selectedValue={availableOutputs.includes(outputType) ? outputType : availableOutputs[0]}
              onValueChange={onOutputTypeChange}
              style={{ color: theme.colors.text, backgroundColor: theme.colors.surface }}
            >
              {availableOutputs.map((type) => (
                <Picker.Item key={type} label={type.toUpperCase()} value={type} />
              ))}
            </Picker>
          </View>
        </View>
      </View>

      <TouchableOpacity
        disabled={isConverting}
        style={[
          styles.convertButton,
          { backgroundColor: isConverting ? theme.colors.muted : theme.colors.primary }
        ]}
        onPress={onConvert}
      >
        <Text style={styles.convertButtonText}>
          {isConverting ? `${labels.converting}...` : labels.convert}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    gap: 16,
    padding: 16
  },
  fileButton: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50
  },
  fileButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800"
  },
  fileList: {
    gap: 6
  },
  label: {
    fontSize: 13,
    fontWeight: "800"
  },
  fileName: {
    flex: 1,
    fontSize: 14
  },
  fileRow: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingLeft: 10,
    paddingRight: 6
  },
  removeButton: {
    alignItems: "center",
    borderRadius: 6,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  editButton: {
    alignItems: "center",
    borderRadius: 6,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  clearButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 10
  },
  clearText: {
    fontSize: 13,
    fontWeight: "800"
  },
  row: {
    flexDirection: "row",
    gap: 12
  },
  pickerGroup: {
    flex: 1,
    gap: 6
  },
  pickerShell: {
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 50,
    overflow: "hidden"
  },
  detectedBox: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50
  },
  detectedText: {
    fontSize: 15,
    fontWeight: "900"
  },
  convertButton: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52
  },
  convertButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900"
  }
});
