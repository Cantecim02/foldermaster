import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Appearance,
  Easing,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  useWindowDimensions,
  View
} from "react-native";
import { SafeAreaInsetsContext, SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import Slider from "@react-native-community/slider";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import * as Speech from "expo-speech";
import { AppSplashScreen } from "./src/components/AppSplashScreen";
import { ArchiveManager } from "./src/components/ArchiveManager";
import type { ArchiveQuickIntent } from "./src/components/ArchiveManager";
import { ConversionForm } from "./src/components/ConversionForm";
import { ConversionLoader } from "./src/components/ConversionLoader";
import { DocumentEditorCard } from "./src/components/DocumentEditorCard";
import { DocumentEditorScreen, EditorTool } from "./src/components/DocumentEditorScreen";
import { HistoryList } from "./src/components/HistoryList";
import { ProgressBar } from "./src/components/ProgressBar";
import { InstagramGradient } from "./src/components/ui/InstagramGradient";
import { useHistory } from "./src/hooks/useHistory";
import { Language, getInitialLanguage, translations } from "./src/i18n";
import { compressPdfFile, convertFiles } from "./src/services/conversionService";
import { getAvailableOutputs, mimeByType, supportedConversions } from "./src/services/conversionTypes";
import { detectFileTypeInfo, fileTypeFromDetection } from "./src/services/fileTypeDetector";
import {
  archivePickerMimeTypes,
  createFileRouteLogMetadata,
  routeFileForOperation
} from "./src/services/fileRouter";
import { addZippedOutput } from "./src/services/zippedOutputStore";
import {
  clearInternalErrors,
  formatInternalErrorReport,
  installErrorMonitor,
  listInternalErrors,
  recordBreadcrumb,
  recordInternalError,
  type ErrorLogEntry
} from "./src/services/errorMonitor";
import {
  DocumentEditLayer,
  DocumentPagePlanItem,
  DocumentPreviewSource,
  applyDocumentEdits,
  createDocumentPreviewSource,
  extractEditableDocumentText,
  inspectEditableDocument
} from "./src/services/documentEditorService";
import { ThemeMode, getTheme } from "./src/theme";
import { AppFile, ConvertedFile, ConversionJob, FileType } from "./src/types";

const defaultInput: FileType = "pdf";
const defaultOutput: FileType = "jpg";
const filePreparationDisplayMs = 1300;
const minimumConversionLoaderMs = 1600;
const savedSignaturesStorageKey = "foldermaster.savedDrawnSignatures.v1";
const showInternalDiagnostics = process.env.EXPO_PUBLIC_INTERNAL_DIAGNOSTICS === "true";
const languageOptions: Array<{ code: Language; flag: string; nativeName: string; englishName: string }> = [
  { code: "en", flag: "🇺🇸", nativeName: "English", englishName: "English" },
  { code: "tr", flag: "🇹🇷", nativeName: "Türkçe", englishName: "Turkish" },
  { code: "zh", flag: "🇨🇳", nativeName: "中文", englishName: "Chinese" },
  { code: "fr", flag: "🇫🇷", nativeName: "Français", englishName: "French" },
  { code: "ru", flag: "🇷🇺", nativeName: "Русский", englishName: "Russian" },
  { code: "de", flag: "🇩🇪", nativeName: "Deutsch", englishName: "German" },
  { code: "es", flag: "🇪🇸", nativeName: "Español", englishName: "Spanish" }
];
const floatingBrandMark = require("./assets/branding/foldermaster-mark-transparent.png");
type SavedDrawnSignature = { id: string; points: Array<{ x: number; y: number; move?: boolean }> };
const mainBrandVisual = require("./assets/branding/foldermaster-launch-clean.png");
type HomeQuickAction =
  | "scanDocument"
  | "createPdf"
  | "compressPdf"
  | "convertUdf"
  | "editPdf"
  | "fillSign"
  | "readAloud"
  | "exportPdf"
  | "zipCreate"
  | "zipOpen"
  | "toMp3"
  | "toMp4";
type SettingsDocumentKey = "privacy" | "terms" | "thirdParty" | "about" | "openSource";
type SettingsDocument = {
  title: string;
  subtitle: string;
  summary: string;
  icon: keyof typeof Feather.glyphMap;
  sections: Array<{ title: string; body: string[] }>;
};
const settingsDocumentOrder: SettingsDocumentKey[] = ["privacy", "terms", "thirdParty", "about", "openSource"];

function getSettingsDocuments(language: Language): Record<SettingsDocumentKey, SettingsDocument> {
  const trDocuments: Record<SettingsDocumentKey, SettingsDocument> = {
    privacy: {
      title: "Editio Gizlilik Politikası",
      subtitle: "Son Güncelleme: 12 Haziran 2026",
      summary: "Dosya işleme, geçici sunucu kullanımı ve güvenlik açıklamaları.",
      icon: "shield",
      sections: [
        {
          title: "Toplanan Bilgiler",
          body: [
            "Editio, seçtiğiniz dosyaları yalnızca dönüştürme, düzenleme, sıkıştırma veya paylaşım işlemini tamamlamak için işler.",
            "Uygulama reklam göstermez ve kullanıcıları izlemeye yönelik üçüncü taraf reklam/analitik SDK'sı kullanmaz."
          ]
        },
        {
          title: "Dosyalarınız",
          body: [
            "Dosyalarınız mümkün olduğunda cihaz üzerinde işlenir. Sunucu tarafı işlem gerektiğinde dosyalar yalnızca ilgili işlemi tamamlamak için aktarılır.",
            "Aksi açıkça belirtilmediği sürece dosyalar geliştirici sunucularında kalıcı olarak saklanmaz."
          ]
        },
        {
          title: "Tanılama",
          body: [
            "Dahili geliştirici sürümlerinde teknik hata kayıtları yalnızca sorun gidermek amacıyla tutulabilir.",
            "Bu kayıtlar, kullanıcı tarafından seçilen dosya içeriklerini okumak veya saklamak için kullanılmaz."
          ]
        },
        {
          title: "Güvenlik ve İletişim",
          body: [
            "Verilerinizi korumak için makul teknik ve idari güvenlik önlemleri uygulanır.",
            "Gizlilik soruları için support@editio.app adresinden bize ulaşabilirsiniz."
          ]
        }
      ]
    },
    terms: {
      title: "Editio Kullanım Koşulları",
      subtitle: "Uygulamayı kullanarak bu şartları kabul etmiş sayılırsınız.",
      summary: "Hizmet kullanımı, sorumluluk, telif ve erişim koşulları.",
      icon: "file-text",
      sections: [
        {
          title: "Hizmet Kullanımı",
          body: [
            "Editio; dosya dönüştürme, PDF düzenleme, imza ekleme, sesli okuma, arşiv oluşturma ve arşiv çıkarma amacıyla sunulur.",
            "Kullanıcı, uygulamayı yürürlükteki yasalara ve üçüncü taraf haklarına uygun şekilde kullanmalıdır."
          ]
        },
        {
          title: "Sorumluluk ve Telif Hakları",
          body: [
            "Kullanıcı tarafından yüklenen veya işlenen içeriklerden kullanıcı sorumludur.",
            "Kullanıcı yalnızca işlem yapma hakkına sahip olduğu dosyaları kullanmalıdır. Telif hakkı ihlallerinden kullanıcı sorumludur.",
            "Editio, kullanıcı içeriklerinin doğruluğundan, yasallığından veya sonuç dosyalarının belirli bir amaca uygunluğundan sorumlu değildir."
          ]
        },
        {
          title: "Hizmet Değişiklikleri",
          body: [
            "Editio, önceden bildirimde bulunmaksızın özellik ekleme, kaldırma, sınırlama veya değiştirme hakkını saklı tutar.",
            "Kötüye kullanım, yasa dışı kullanım veya sistem güvenliğini tehlikeye atan davranışlarda hizmet erişimi sınırlandırılabilir."
          ]
        }
      ]
    },
    thirdParty: {
      title: "Üçüncü Taraf Bildirimleri",
      subtitle: "Editio içinde kullanılan açık kaynak ve üçüncü taraf teknolojiler.",
      summary: "Kütüphane, SDK ve servis bildirimleri.",
      icon: "box",
      sections: [
        {
          title: "Kullanılan Teknolojiler",
          body: [
            "Editio; React Native, Expo, pdf-lib, react-native-pdf, react-native-fs / react-native-blob-util, react-native-document-scanner-plugin, PDF.js, JSZip, pako, mammoth ve benzeri açık kaynak teknolojilerden yararlanabilir.",
            "Medya dönüştürme akışlarında FFmpeg veya FFmpeg tabanlı backend servisleri kullanılabilir.",
            "Yayın sürümünde reklam veya kullanıcı takibi için üçüncü taraf SDK kullanılmaz."
          ]
        },
        {
          title: "Lisanslar",
          body: [
            "Her kütüphane ve servis kendi lisans koşullarına tabidir.",
            "Açık kaynak lisansları, ilgili proje sahiplerinin depolarında ve paket dağıtımlarında yayımlanan koşullara göre geçerlidir."
          ]
        }
      ]
    },
    about: {
      title: "Editio Hakkında",
      subtitle: "Sürüm 1.0.0",
      summary: "Editio'nun amacı, özellikleri ve sürüm bilgisi.",
      icon: "info",
      sections: [
        {
          title: "Editio",
          body: [
            "Editio, belgeleri ve dosyaları kolayca dönüştürmek, düzenlemek, imzalamak ve paylaşmak için geliştirilmiş modern bir mobil uygulamadır.",
            "Öne çıkan özellikler: PDF düzenleme, PDF dönüştürme, görsel dönüştürme, doküman dönüştürme, dosya sıkıştırma ve açma, imza ekleme, metin ekleme, annotation araçları ve sesli okuma.",
            "© 2026 Editio. Tüm hakları saklıdır."
          ]
        }
      ]
    },
    openSource: {
      title: "Açık Kaynak Lisansları",
      subtitle: "Editio'nun yararlandığı açık kaynak bileşenler.",
      summary: "Açık kaynak kullanım ve lisans notları.",
      icon: "code",
      sections: [
        {
          title: "Lisans Bilgileri",
          body: [
            "Editio çeşitli açık kaynak projelerden yararlanır. Her proje kendi lisansı kapsamında kullanılmaktadır.",
            "Detaylı lisans bilgileri, ilgili paketlerin lisans dosyalarında veya proje depolarında bulunmaktadır.",
            "Bu ekran, App Store incelemesi ve kullanıcı şeffaflığı için uygulama içinde özet bildirim sağlar."
          ]
        }
      ]
    }
  };

  const enDocuments: Record<SettingsDocumentKey, SettingsDocument> = {
    privacy: {
      title: "Editio Privacy Policy",
      subtitle: "Last updated: June 12, 2026",
      summary: "File processing, temporary server use, and security.",
      icon: "shield",
      sections: [
        {
          title: "Information We Process",
          body: [
            "Editio processes selected files only to complete conversion, editing, compression, extraction, or sharing workflows.",
            "Editio does not show ads and does not use third-party advertising or user-tracking analytics SDKs."
          ]
        },
        {
          title: "Your Files",
          body: [
            "Files are processed on device whenever possible. When server-side processing is required, files are transferred only to complete the requested operation.",
            "Unless explicitly stated otherwise, files are not permanently stored on developer servers."
          ]
        },
        {
          title: "Security and Contact",
          body: [
            "Reasonable technical and administrative safeguards are used to protect your data.",
            "For privacy questions, contact support@editio.app."
          ]
        }
      ]
    },
    terms: {
      title: "Editio Terms of Use",
      subtitle: "By using Editio, you agree to these terms.",
      summary: "Service usage, responsibilities, copyright, and access.",
      icon: "file-text",
      sections: [
        {
          title: "Service Usage",
          body: [
            "Editio is provided for file conversion, PDF editing, visible signatures, read-aloud, ZIP creation, and archive extraction.",
            "You must use the app in accordance with applicable laws and third-party rights."
          ]
        },
        {
          title: "Responsibility and Copyright",
          body: [
            "You are responsible for the files and content you select or process.",
            "Only use files you have the right to process. You are responsible for copyright violations.",
            "Editio is not responsible for the legality, accuracy, or suitability of user content."
          ]
        },
        {
          title: "Service Changes",
          body: [
            "Editio may add, remove, limit, or change features without prior notice.",
            "Access may be limited if misuse, unlawful use, or security abuse is detected."
          ]
        }
      ]
    },
    thirdParty: {
      title: "Third-Party Notices",
      subtitle: "Open-source and third-party technology used by Editio.",
      summary: "Libraries, SDKs, services, and license notices.",
      icon: "box",
      sections: [
        {
          title: "Technologies",
          body: [
            "Editio may use React Native, Expo, pdf-lib, react-native-pdf, react-native-fs / react-native-blob-util, react-native-document-scanner-plugin, PDF.js, JSZip, pako, mammoth, and similar open-source technologies.",
            "Media conversion flows may use FFmpeg or FFmpeg-based backend services.",
            "The public release does not use third-party SDKs for advertising or user tracking."
          ]
        },
        {
          title: "Licenses",
          body: [
            "Each library and service is governed by its own license terms.",
            "Full license terms are available from the respective project owners and package distributions."
          ]
        }
      ]
    },
    about: {
      title: "About Editio",
      subtitle: "Version 1.0.0",
      summary: "Purpose, features, and version information.",
      icon: "info",
      sections: [
        {
          title: "Editio",
          body: [
            "Editio is a modern mobile app for converting, editing, signing, reading, compressing, and sharing documents and files.",
            "Highlights include PDF editing, PDF conversion, image conversion, document conversion, ZIP tools, signatures, text annotations, drawing tools, and read-aloud.",
            "© 2026 Editio. All rights reserved."
          ]
        }
      ]
    },
    openSource: {
      title: "Open Source Licenses",
      subtitle: "Open-source components used by Editio.",
      summary: "Open-source usage and license summary.",
      icon: "code",
      sections: [
        {
          title: "License Information",
          body: [
            "Editio uses several open-source projects. Each project is used under its respective license.",
            "Detailed license information is available in the license files or repositories of the related projects.",
            "This screen provides an in-app summary for App Store review and user transparency."
          ]
        }
      ]
    }
  };

  return language === "tr" ? trDocuments : enDocuments;
}
const quickActionItems: Array<{
  action: HomeQuickAction;
  title: string;
  body: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  softColor: string;
}> = [
  {
    action: "scanDocument",
    title: "Belge tara",
    body: "Kamerayla belgeyi algılayıp PDF'e dönüştür.",
    icon: "camera",
    color: "#1E90FF",
    softColor: "rgba(30,144,255,0.13)"
  },
  {
    action: "createPdf",
    title: "PDF oluştur",
    body: "PDF'e çevirmek istediğin görseli veya belgeyi cihazdan seç.",
    icon: "file-plus",
    color: "#DD2A7B",
    softColor: "rgba(221,42,123,0.13)"
  },
  {
    action: "compressPdf",
    title: "PDF sıkıştır",
    body: "PDF boyutunu küçült, sonucu KB/MB olarak gör ve paylaş.",
    icon: "minimize-2",
    color: "#F58529",
    softColor: "rgba(245,133,41,0.15)"
  },
  {
    action: "convertUdf",
    title: "UDF dönüştür",
    body: "UDF dosyasını PDF, DOCX veya TXT gibi formatlara dönüştür.",
    icon: "file-text",
    color: "#4CAF50",
    softColor: "rgba(76,175,80,0.14)"
  },
  {
    action: "editPdf",
    title: "PDF düzenle",
    body: "Düzenlemek istediğin PDF, görsel veya TXT dosyasını seç.",
    icon: "edit-3",
    color: "#8134AF",
    softColor: "rgba(129,52,175,0.14)"
  },
  {
    action: "fillSign",
    title: "Doldur ve imzala",
    body: "İmza veya metin eklemek istediğin belgeyi cihazdan seç.",
    icon: "pen-tool",
    color: "#F58529",
    softColor: "rgba(245,133,41,0.15)"
  },
  {
    action: "readAloud",
    title: "Sesli okuma",
    body: "Okunmasını istediğin PDF veya metin dosyasını seç.",
    icon: "volume-2",
    color: "#1E90FF",
    softColor: "rgba(30,144,255,0.13)"
  },
  {
    action: "exportPdf",
    title: "PDF'yi dışa aktar",
    body: "Görsel olarak dışa aktarmak istediğin PDF dosyasını seç.",
    icon: "share",
    color: "#4CAF50",
    softColor: "rgba(76,175,80,0.14)"
  },
  {
    action: "zipCreate",
    title: "ZIP oluştur",
    body: "Sıkıştırmak istediğin dosyaları seç; arşiv ekranında ZIP paketini oluştur.",
    icon: "package",
    color: "#F58529",
    softColor: "rgba(245,133,41,0.15)"
  },
  {
    action: "zipOpen",
    title: "ZIP aç",
    body: "Açmak istediğin ZIP dosyasını seç; çıkarılan dosyaları listede gösterelim.",
    icon: "archive",
    color: "#8134AF",
    softColor: "rgba(129,52,175,0.14)"
  },
  {
    action: "toMp3",
    title: "MP3'e dönüştür",
    body: "Ses veya videodan MP3 çıktı almak için dosya seç.",
    icon: "music",
    color: "#DD2A7B",
    softColor: "rgba(221,42,123,0.13)"
  },
  {
    action: "toMp4",
    title: "MP4'e dönüştür",
    body: "MP4'e dönüştürmek istediğin GIF veya video dosyasını seç.",
    icon: "video",
    color: "#1E90FF",
    softColor: "rgba(30,144,255,0.13)"
  }
];

const quickActionSectionCopies: Record<Language, { title: string; subtitle: string }> = {
  en: { title: "What do you want to do?", subtitle: "Choose an action and pick files from your device." },
  tr: { title: "Ne yapmak istiyorsun?", subtitle: "İşlemi seç, dosyanı cihazdan alalım." },
  zh: { title: "你想做什么？", subtitle: "选择操作，然后从设备中选择文件。" },
  fr: { title: "Que voulez-vous faire ?", subtitle: "Choisissez une action et sélectionnez vos fichiers." },
  ru: { title: "Что сделать?", subtitle: "Выберите действие и файл на устройстве." },
  de: { title: "Was möchten Sie tun?", subtitle: "Aktion wählen und Datei vom Gerät auswählen." },
  es: { title: "¿Qué quieres hacer?", subtitle: "Elige una acción y selecciona archivos del dispositivo." }
};

const quickActionCopies: Record<Language, Record<HomeQuickAction, { title: string; body: string }>> = {
  en: {
    scanDocument: { title: "Scan document", body: "Use the camera to detect pages and convert them to PDF." },
    createPdf: { title: "Create PDF", body: "Pick images or documents and convert them to PDF." },
    compressPdf: { title: "Compress PDF", body: "Reduce PDF size, review KB/MB savings, and share the result." },
    convertUdf: { title: "Convert UDF", body: "Pick a UDF file and convert it to PDF, DOCX, or TXT." },
    editPdf: { title: "Edit PDF", body: "Choose a PDF, image, or TXT file to edit." },
    fillSign: { title: "Fill & sign", body: "Add a signature or text to a document." },
    readAloud: { title: "Read aloud", body: "Choose a PDF or text file to listen to." },
    exportPdf: { title: "Export PDF", body: "Export a PDF as visual output." },
    zipCreate: { title: "Create ZIP", body: "Pick files and create a ZIP package in Archive." },
    zipOpen: { title: "Open ZIP", body: "Pick a ZIP file and extract its contents." },
    toMp3: { title: "Convert to MP3", body: "Pick audio or video and create an MP3 output." },
    toMp4: { title: "Convert to MP4", body: "Pick GIF or video and create an MP4 output." }
  },
  tr: {
    scanDocument: { title: "Belge tara", body: "Kamerayla belgeyi algılayıp PDF'e dönüştür." },
    createPdf: { title: "PDF oluştur", body: "PDF'e çevirmek istediğin görseli veya belgeyi cihazdan seç." },
    compressPdf: { title: "PDF sıkıştır", body: "PDF boyutunu küçült, KB/MB tasarrufu gör ve sonucu paylaş." },
    convertUdf: { title: "UDF dönüştür", body: "UDF dosyasını PDF, DOCX veya TXT gibi formatlara dönüştür." },
    editPdf: { title: "PDF düzenle", body: "Düzenlemek istediğin PDF, görsel veya TXT dosyasını seç." },
    fillSign: { title: "Doldur ve imzala", body: "İmza veya metin eklemek istediğin belgeyi cihazdan seç." },
    readAloud: { title: "Sesli okuma", body: "Okunmasını istediğin PDF veya metin dosyasını seç." },
    exportPdf: { title: "PDF'yi dışa aktar", body: "Görsel olarak dışa aktarmak istediğin PDF dosyasını seç." },
    zipCreate: { title: "ZIP oluştur", body: "Sıkıştırmak istediğin dosyaları seç; arşiv ekranında ZIP paketini oluştur." },
    zipOpen: { title: "ZIP aç", body: "Açmak istediğin ZIP dosyasını seç; çıkarılan dosyaları listede gösterelim." },
    toMp3: { title: "MP3'e dönüştür", body: "Ses veya videodan MP3 çıktı almak için dosya seç." },
    toMp4: { title: "MP4'e dönüştür", body: "MP4'e dönüştürmek istediğin GIF veya video dosyasını seç." }
  },
  zh: {
    scanDocument: { title: "扫描文档", body: "使用相机识别页面并转换为 PDF。" },
    createPdf: { title: "创建 PDF", body: "选择图片或文档并转换为 PDF。" },
    compressPdf: { title: "压缩 PDF", body: "减小 PDF 体积，查看节省空间并分享。" },
    convertUdf: { title: "转换 UDF", body: "选择 UDF 文件并转换为 PDF、DOCX 或 TXT。" },
    editPdf: { title: "编辑 PDF", body: "选择 PDF、图片或 TXT 文件进行编辑。" },
    fillSign: { title: "填写和签名", body: "为文档添加签名或文字。" },
    readAloud: { title: "朗读", body: "选择 PDF 或文本文件进行朗读。" },
    exportPdf: { title: "导出 PDF", body: "将 PDF 导出为可视文件。" },
    zipCreate: { title: "创建 ZIP", body: "选择文件并在归档页创建 ZIP 包。" },
    zipOpen: { title: "打开 ZIP", body: "选择 ZIP 文件并解压内容。" },
    toMp3: { title: "转为 MP3", body: "选择音频或视频并生成 MP3。" },
    toMp4: { title: "转为 MP4", body: "选择 GIF 或视频并生成 MP4。" }
  },
  fr: {
    scanDocument: { title: "Scanner document", body: "Utilisez l'appareil photo pour détecter les pages et créer un PDF." },
    createPdf: { title: "Créer PDF", body: "Choisissez des images ou documents à convertir en PDF." },
    compressPdf: { title: "Compresser PDF", body: "Réduisez la taille du PDF, voyez le gain et partagez le résultat." },
    convertUdf: { title: "Convertir UDF", body: "Choisissez un UDF à convertir en PDF, DOCX ou TXT." },
    editPdf: { title: "Modifier PDF", body: "Choisissez un PDF, une image ou un TXT à modifier." },
    fillSign: { title: "Remplir et signer", body: "Ajoutez une signature ou du texte au document." },
    readAloud: { title: "Lecture audio", body: "Choisissez un PDF ou texte à écouter." },
    exportPdf: { title: "Exporter PDF", body: "Exportez un PDF en sortie visuelle." },
    zipCreate: { title: "Créer ZIP", body: "Choisissez des fichiers et créez un ZIP." },
    zipOpen: { title: "Ouvrir ZIP", body: "Choisissez un ZIP et extrayez son contenu." },
    toMp3: { title: "Convertir en MP3", body: "Choisissez audio ou vidéo pour générer un MP3." },
    toMp4: { title: "Convertir en MP4", body: "Choisissez GIF ou vidéo pour générer un MP4." }
  },
  ru: {
    scanDocument: { title: "Сканировать документ", body: "Используйте камеру, чтобы распознать страницы и создать PDF." },
    createPdf: { title: "Создать PDF", body: "Выберите изображения или документы для PDF." },
    compressPdf: { title: "Сжать PDF", body: "Уменьшите размер PDF, посмотрите экономию и поделитесь файлом." },
    convertUdf: { title: "Конвертировать UDF", body: "Выберите UDF и преобразуйте в PDF, DOCX или TXT." },
    editPdf: { title: "Редактировать PDF", body: "Выберите PDF, изображение или TXT для правки." },
    fillSign: { title: "Заполнить и подписать", body: "Добавьте подпись или текст в документ." },
    readAloud: { title: "Озвучить", body: "Выберите PDF или текст для чтения." },
    exportPdf: { title: "Экспорт PDF", body: "Экспортируйте PDF как визуальный файл." },
    zipCreate: { title: "Создать ZIP", body: "Выберите файлы и создайте ZIP в архиве." },
    zipOpen: { title: "Открыть ZIP", body: "Выберите ZIP и извлеките содержимое." },
    toMp3: { title: "В MP3", body: "Выберите аудио или видео для MP3." },
    toMp4: { title: "В MP4", body: "Выберите GIF или видео для MP4." }
  },
  de: {
    scanDocument: { title: "Dokument scannen", body: "Seiten mit der Kamera erkennen und als PDF umwandeln." },
    createPdf: { title: "PDF erstellen", body: "Bilder oder Dokumente auswählen und in PDF umwandeln." },
    compressPdf: { title: "PDF komprimieren", body: "PDF verkleinern, Ersparnis prüfen und Ergebnis teilen." },
    convertUdf: { title: "UDF konvertieren", body: "UDF-Datei wählen und in PDF, DOCX oder TXT umwandeln." },
    editPdf: { title: "PDF bearbeiten", body: "PDF, Bild oder TXT zum Bearbeiten wählen." },
    fillSign: { title: "Ausfüllen & signieren", body: "Signatur oder Text zum Dokument hinzufügen." },
    readAloud: { title: "Vorlesen", body: "PDF oder Textdatei zum Vorlesen wählen." },
    exportPdf: { title: "PDF exportieren", body: "PDF als visuelle Ausgabe exportieren." },
    zipCreate: { title: "ZIP erstellen", body: "Dateien wählen und im Archiv als ZIP packen." },
    zipOpen: { title: "ZIP öffnen", body: "ZIP-Datei wählen und Inhalte entpacken." },
    toMp3: { title: "In MP3", body: "Audio oder Video wählen und MP3 erstellen." },
    toMp4: { title: "In MP4", body: "GIF oder Video wählen und MP4 erstellen." }
  },
  es: {
    scanDocument: { title: "Escanear documento", body: "Usa la cámara para detectar páginas y convertirlas a PDF." },
    createPdf: { title: "Crear PDF", body: "Elige imágenes o documentos y conviértelos a PDF." },
    compressPdf: { title: "Comprimir PDF", body: "Reduce el tamaño del PDF, revisa el ahorro y comparte el resultado." },
    convertUdf: { title: "Convertir UDF", body: "Elige un UDF y conviértelo a PDF, DOCX o TXT." },
    editPdf: { title: "Editar PDF", body: "Elige un PDF, imagen o TXT para editar." },
    fillSign: { title: "Rellenar y firmar", body: "Añade firma o texto al documento." },
    readAloud: { title: "Leer en voz alta", body: "Elige un PDF o texto para escuchar." },
    exportPdf: { title: "Exportar PDF", body: "Exporta un PDF como salida visual." },
    zipCreate: { title: "Crear ZIP", body: "Elige archivos y crea un paquete ZIP." },
    zipOpen: { title: "Abrir ZIP", body: "Elige un ZIP y extrae su contenido." },
    toMp3: { title: "Convertir a MP3", body: "Elige audio o video y crea un MP3." },
    toMp4: { title: "Convertir a MP4", body: "Elige GIF o video y crea un MP4." }
  }
};

export default function App() {
  const systemScheme = useColorScheme();
  const { width, height } = useWindowDimensions();
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [language, setLanguage] = useState(getInitialLanguage());
  const [files, setFiles] = useState<AppFile[]>([]);
  const [inputType, setInputType] = useState<FileType>(defaultInput);
  const [outputType, setOutputType] = useState<FileType>(defaultOutput);
  const [progress, setProgress] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [isPreparingSelection, setIsPreparingSelection] = useState(false);
  const [showPrepareNotice, setShowPrepareNotice] = useState(false);
  const [preparationProgress, setPreparationProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<"convert" | "archive" | "history" | "trash" | "settings" | "editor">("convert");
  const [error, setError] = useState<string | null>(null);
  const [lastJob, setLastJob] = useState<ConversionJob | null>(null);
  const [gifTrimVisible, setGifTrimVisible] = useState(false);
  const [gifStartSeconds, setGifStartSeconds] = useState(0);
  const [gifDurationSeconds, setGifDurationSeconds] = useState(3);
  const [gifVideoDuration, setGifVideoDuration] = useState(0);
  const [gifCurrentSeconds, setGifCurrentSeconds] = useState(0);
  const [gifThumbnails, setGifThumbnails] = useState<Array<{ id: string; source: any }>>([]);
  const [isGeneratingGifThumbnails, setIsGeneratingGifThumbnails] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AppFile | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [shareConfirmJob, setShareConfirmJob] = useState<ConversionJob | null>(null);
  const [conversionModalVisible, setConversionModalVisible] = useState(false);
  const [quickActionPicker, setQuickActionPicker] = useState<HomeQuickAction | null>(null);
  const [archiveQuickIntent, setArchiveQuickIntent] = useState<ArchiveQuickIntent | null>(null);
  const [settingsDocumentKey, setSettingsDocumentKey] = useState<SettingsDocumentKey | null>(null);
  const [settingsDocumentVisible, setSettingsDocumentVisible] = useState(false);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [diagnosticEntries, setDiagnosticEntries] = useState<ErrorLogEntry[]>([]);
  const [isScanningDocument, setIsScanningDocument] = useState(false);
  const [pendingEditorAction, setPendingEditorAction] = useState<"signature" | "read" | null>(null);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [languageTransitionVisible, setLanguageTransitionVisible] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [editorFile, setEditorFile] = useState<AppFile | null>(null);
  const [editorPreviewSource, setEditorPreviewSource] = useState<DocumentPreviewSource | null>(null);
  const [editorOutput, setEditorOutput] = useState<ConvertedFile | null>(null);
  const [editorPageCount, setEditorPageCount] = useState(1);
  const [editorPageNumber, setEditorPageNumber] = useState(1);
  const [editorPagePlan, setEditorPagePlan] = useState<DocumentPagePlanItem[]>([]);
  const [editorLayers, setEditorLayers] = useState<DocumentEditLayer[]>([]);
  const [editorRedoLayers, setEditorRedoLayers] = useState<DocumentEditLayer[]>([]);
  const [selectedEditorLayerId, setSelectedEditorLayerId] = useState<string | null>(null);
  const [activeEditorTool, setActiveEditorTool] = useState<EditorTool>("select");
  const [editorStrokeColor, setEditorStrokeColor] = useState("#111827");
  const [editorStrokeWidth, setEditorStrokeWidth] = useState(4);
  const [savedDrawnSignatures, setSavedDrawnSignatures] = useState<SavedDrawnSignature[]>([]);
  const [isEditorBusy, setIsEditorBusy] = useState(false);
  const [editorApplyProgress, setEditorApplyProgress] = useState(0);
  const [editorResultModalVisible, setEditorResultModalVisible] = useState(false);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);
  const [isReadingDocument, setIsReadingDocument] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.92);
  const [speechVoiceIdentifier, setSpeechVoiceIdentifier] = useState<string | null>(null);
  const screenSlide = useRef(new Animated.Value(0)).current;
  const convertSpin = useRef(new Animated.Value(0)).current;
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const splashProgress = useRef(new Animated.Value(0)).current;
  const splashScale = useRef(new Animated.Value(0.96)).current;
  const splashTranslateY = useRef(new Animated.Value(10)).current;
  const languageSwitchProgress = useRef(new Animated.Value(0)).current;
  const shouldRestartReadingOnPageChange = useRef(false);
  const settingsDocumentCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    installErrorMonitor();
    void listInternalErrors()
      .then(setDiagnosticEntries)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(savedSignaturesStorageKey)
      .then((value) => {
        if (!value) return;
        const parsed = JSON.parse(value) as SavedDrawnSignature[];
        if (Array.isArray(parsed)) setSavedDrawnSignatures(parsed.slice(0, 3));
      })
      .catch(() => undefined);
  }, []);
  const prepareNoticeAnim = useRef(new Animated.Value(0)).current;
  const gifPreviewUri = files[0]?.uri ?? null;
  const gifPlayer = useVideoPlayer(gifPreviewUri ? { uri: gifPreviewUri } : null, (player) => {
    player.loop = true;
    player.muted = true;
    player.timeUpdateEventInterval = 0.25;
  });
  const {
    history,
    trash,
    addHistory,
    clearHistory,
    deleteHistoryJob,
    restoreTrashJob,
    deleteTrashJobForever,
    emptyTrash
  } = useHistory();
  const theme = useMemo(() => getTheme(themeMode, systemScheme), [themeMode, systemScheme]);
  const t = translations[language];
  const isLandscape = width > height;
  const settingsDocuments = useMemo(() => getSettingsDocuments(language), [language]);
  const activeSettingsDocument = settingsDocumentKey ? settingsDocuments[settingsDocumentKey] : null;
  const currentLanguageOption = languageOptions.find((item) => item.code === language) ?? languageOptions[0];
  const quickActionSectionCopy = quickActionSectionCopies[language] ?? quickActionSectionCopies.en;
  const localizedQuickActionItems = quickActionItems.map((item) => ({
    ...item,
    ...((quickActionCopies[language] ?? quickActionCopies.en)[item.action] ?? quickActionCopies.en[item.action])
  }));
  const quickActionPickerItem = localizedQuickActionItems.find((item) => item.action === quickActionPicker) ?? localizedQuickActionItems[0];
  const quickActionCanUseGallery =
    quickActionPicker !== null &&
    quickActionPicker !== "compressPdf" &&
    quickActionPicker !== "exportPdf" &&
    quickActionPicker !== "zipOpen" &&
    quickActionPicker !== "convertUdf";
  const speechLocale = speechLocaleForLanguage(language);
  const availableOutputs = getAvailableOutputs(inputType);
  const selectedOutputType = availableOutputs.includes(outputType) ? outputType : availableOutputs[0];
  const convertRotate = convertSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"]
  });
  const languageSwitchWidth = languageSwitchProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["8%", "100%"]
  });

  const openSettingsDocument = (key: SettingsDocumentKey) => {
    if (settingsDocumentCloseTimer.current) {
      clearTimeout(settingsDocumentCloseTimer.current);
      settingsDocumentCloseTimer.current = null;
    }
    setSettingsDocumentKey(key);
    setSettingsDocumentVisible(true);
  };

  const closeSettingsDocument = () => {
    setSettingsDocumentVisible(false);
    if (settingsDocumentCloseTimer.current) clearTimeout(settingsDocumentCloseTimer.current);
    settingsDocumentCloseTimer.current = setTimeout(() => {
      setSettingsDocumentKey(null);
      settingsDocumentCloseTimer.current = null;
    }, 320);
  };

  const consumeArchiveQuickIntent = useCallback((id: number) => {
    setArchiveQuickIntent((current) => (current?.id === id ? null : current));
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    const entries = await listInternalErrors();
    setDiagnosticEntries(entries);
    return entries;
  }, []);

  const openDiagnostics = () => {
    setDiagnosticsVisible(true);
    void refreshDiagnostics();
  };

  const clearDiagnostics = async () => {
    await clearInternalErrors();
    setDiagnosticEntries([]);
  };

  const shareDiagnostics = async () => {
    try {
      const entries = diagnosticEntries.length ? diagnosticEntries : await refreshDiagnostics();
      const report = formatInternalErrorReport(entries);

      if (Platform.OS === "web") {
        const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(blob);
        anchor.download = `editio-diagnostics-${Date.now()}.txt`;
        anchor.click();
        URL.revokeObjectURL(anchor.href);
        return;
      }

      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!directory) {
        Alert.alert(t.shareUnavailableTitle, t.shareUnavailableBody);
        return;
      }

      const uri = `${directory}editio-diagnostics-${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(uri, report);
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(t.shareUnavailableTitle, t.shareUnavailableBody);
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: "text/plain", dialogTitle: "Editio diagnostics" });
    } catch (caught) {
      void recordInternalError("error", [caught], "diagnostics.share");
      Alert.alert(t.shareUnavailableTitle, t.shareUnavailableBody);
    }
  };

  useEffect(() => {
    const subscription = Appearance.addChangeListener(() => {
      if (themeMode === "system") setThemeMode("system");
    });
    return () => subscription.remove();
  }, [themeMode]);

  useEffect(() => {
    return () => {
      if (settingsDocumentCloseTimer.current) clearTimeout(settingsDocumentCloseTimer.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setSpeechVoiceIdentifier(null);
    shouldRestartReadingOnPageChange.current = false;
    Speech.stop();
    setIsReadingDocument(false);
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        if (!alive) return;
        setSpeechVoiceIdentifier(pickSpeechVoiceIdentifier(voices, speechLocale));
      })
      .catch(() => {
        if (alive) setSpeechVoiceIdentifier(null);
      });
    return () => {
      alive = false;
    };
  }, [speechLocale]);

  useEffect(() => {
    const availableOutputs = getAvailableOutputs(inputType);
    if (!availableOutputs.includes(outputType)) {
      setOutputType(availableOutputs[0]);
    }
  }, [inputType, outputType]);

  useEffect(() => {
    if (!isConverting) {
      convertSpin.stopAnimation(() => convertSpin.setValue(0));
      return;
    }

    const loop = Animated.loop(
      Animated.timing(convertSpin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true
      })
    );
    loop.start();
    return () => loop.stop();
  }, [convertSpin, isConverting]);

  useEffect(() => {
    let progressTimer: ReturnType<typeof setInterval> | null = null;

    if (isPreparingSelection) {
      setShowPrepareNotice(true);
      setPreparationProgress(0.12);
      progressTimer = setInterval(() => {
        setPreparationProgress((current) => Math.min(0.92, current + 0.11));
      }, 120);
      Animated.spring(prepareNoticeAnim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 18,
        bounciness: 5
      }).start();
      return () => {
        if (progressTimer) clearInterval(progressTimer);
      };
    }

    setPreparationProgress(1);
    Animated.timing(prepareNoticeAnim, {
      toValue: 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) setShowPrepareNotice(false);
    });

    return undefined;
  }, [isPreparingSelection, prepareNoticeAnim]);

  useEffect(() => {
    screenSlide.setValue(18);
    Animated.spring(screenSlide, {
      toValue: 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 4
    }).start();
  }, [activeTab, screenSlide]);

  useEffect(() => {
    if (activeTab === "editor") return;
    shouldRestartReadingOnPageChange.current = false;
    Speech.stop();
    setIsReadingDocument(false);
  }, [activeTab]);

  useEffect(() => {
    splashProgress.setValue(0);
    Animated.timing(splashProgress, {
      toValue: 1,
      duration: 1200,
      useNativeDriver: false
    }).start();

    Animated.sequence([
      Animated.parallel([
        Animated.spring(splashScale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 14,
          bounciness: 5
        }),
        Animated.timing(splashTranslateY, {
          toValue: 0,
          duration: 360,
          useNativeDriver: true
        })
      ]),
      Animated.delay(980),
      Animated.parallel([
        Animated.timing(splashOpacity, {
          toValue: 0,
          duration: 260,
          useNativeDriver: true
        }),
        Animated.timing(splashScale, {
          toValue: 1.04,
          duration: 260,
          useNativeDriver: true
        }),
        Animated.timing(splashTranslateY, {
          toValue: -10,
          duration: 260,
          useNativeDriver: true
        })
      ])
    ]).start(() => setShowSplash(false));
  }, [splashOpacity, splashProgress, splashScale, splashTranslateY]);

  const selectFiles = async () => {
    if (Platform.OS === "web") {
      await selectDocumentFiles();
      return;
    }

    Alert.alert(t.fileSourceTitle, t.fileSourceBody, [
      { text: t.cancel, style: "cancel" },
      { text: t.chooseFiles, onPress: () => void selectDocumentFiles() },
      { text: t.chooseGallery, onPress: () => void selectGalleryMedia() }
    ]);
  };

  const selectDocumentFiles = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: "*/*"
    });

    if (result.canceled) return;

    const selected = result.assets.map((asset) => ({
      name: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType,
      size: asset.size ?? 0
    }));

    applyFiles(selected);
  };

  const selectGalleryMedia = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t.permissionTitle, t.permissionGallery);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ["images", "videos"],
      orderedSelection: true,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      quality: 1,
      selectionLimit: 0,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.High
    });

    if (result.canceled) return;

    const selected = result.assets.map((asset, index) => {
      const extension = extensionFromGalleryAsset(asset);
      return {
        name: asset.fileName ?? `gallery_${Date.now()}_${index}.${extension}`,
        uri: asset.uri,
        mimeType: asset.mimeType ?? mimeFromGalleryAsset(asset, extension),
        size: asset.fileSize ?? 0
      };
    });

    applyFiles(selected);
  };

  const applyFiles = (
    nextFiles: AppFile[],
    preferredOutput?: FileType,
    options: { showPreparation?: boolean } = {}
  ) => {
    const detectedType = detectFileTypeFromFile(nextFiles[0]);
    const shouldLimit = shouldLimitToSingleFile(detectedType);
    const acceptedFiles = shouldLimit ? nextFiles.slice(0, 1) : nextFiles;
    const shouldShowPreparation = (options.showPreparation ?? true) && acceptedFiles.length > 0;
    const route = acceptedFiles[0] ? routeFileForOperation(acceptedFiles[0], "convert") : null;
    if (route) {
      void recordBreadcrumb("Conversion file route", createFileRouteLogMetadata(route, acceptedFiles[0]));
    }

    setIsPreparingSelection(shouldShowPreparation);
    if (!shouldShowPreparation) {
      setShowPrepareNotice(false);
      setPreparationProgress(0);
    }

    setFiles(acceptedFiles);
    setError(shouldLimit && nextFiles.length > 1 ? t.singleMediaOnly : null);
    setLastJob(null);

    if (detectedType) {
      setInputType(detectedType);
      const outputs = getAvailableOutputs(detectedType);
      const nextOutput = preferredOutput && outputs.includes(preferredOutput) ? preferredOutput : outputs[0];
      if (nextOutput) setOutputType(nextOutput);
    } else if (acceptedFiles.length === 0) {
      setInputType(defaultInput);
      setOutputType(defaultOutput);
    }
    setConversionModalVisible(acceptedFiles.length > 0);
    if (shouldShowPreparation) {
      setTimeout(() => setIsPreparingSelection(false), filePreparationDisplayMs);
    }
  };

  const removeFile = (uri: string) => {
    applyFiles(files.filter((file) => file.uri !== uri), outputType, { showPreparation: false });
  };

  const clearFiles = () => {
    applyFiles([], undefined, { showPreparation: false });
  };

  const openRenameFile = (file: AppFile) => {
    setRenameTarget(file);
    setRenameInput(file.name);
  };

  const confirmRenameFile = () => {
    if (!renameTarget) return;
    const cleanName = buildSafeDisplayName(renameInput, renameTarget.name);
    if (cleanName.length === 0) return;

    setFiles((currentFiles) =>
      currentFiles.map((file) => (file.uri === renameTarget.uri ? { ...file, name: cleanName } : file))
    );
    setRenameTarget(null);
    setRenameInput("");
  };

  const handleConvertPress = () => {
    if (isPreparingSelection) {
      setError(t.preparingFile);
      return;
    }

    const selectedInputType = detectFileTypeFromFile(files[0]) ?? inputType;
    if (isGifSource(selectedInputType) && outputType === "gif") {
      openGifTrimModal();
      return;
    }
    void runConversion();
  };

  const openGifTrimModal = () => {
    setConversionModalVisible(false);
    setGifStartSeconds(0);
    setGifDurationSeconds(3);
    setGifVideoDuration(0);
    setGifCurrentSeconds(0);
    gifPlayer.currentTime = 0;
    setTimeout(() => setGifTrimVisible(true), 120);
  };

  const confirmGifTrim = () => {
    const durationSeconds = Math.min(3, Math.max(0.5, gifDurationSeconds));
    const maxStart = Math.max(0, gifVideoDuration - durationSeconds);
    const startSeconds = Math.min(maxStart || gifStartSeconds, Math.max(0, gifStartSeconds));
    setGifTrimVisible(false);
    setConversionModalVisible(true);
    gifPlayer.pause();
    void runConversion(undefined, { startSeconds, durationSeconds });
  };

  const closeGifTrimModal = () => {
    setGifTrimVisible(false);
    gifPlayer.pause();
    if (files.length > 0) setConversionModalVisible(true);
  };

  const runConversion = async (
    retryJob?: ConversionJob,
    gifTrim?: { startSeconds: number; durationSeconds: number }
  ) => {
    const jobFiles = retryJob?.files ?? files;
    const jobInput = retryJob?.inputType ?? inputType;
    const jobOutput = retryJob?.outputType ?? outputType;
    let conversionStartedAt: number | null = null;

    setError(null);
    setProgress(0);
    setShareConfirmJob(null);

    try {
      if (jobFiles.length === 0) {
        throw new Error(t.errors.noFiles);
      }

      const detectedType = detectFileTypeFromFile(jobFiles[0]);
      if (!detectedType) {
        throw new Error(t.errors.unsupported);
      }

      if (detectedType !== jobInput) {
        setInputType(detectedType);
      }

      if (isGifSource(detectedType) && jobOutput === "gif" && !gifTrim) {
        openGifTrimModal();
        return;
      }

      const conversion = supportedConversions.find(
        (item) => item.input === detectedType && item.output === jobOutput
      );
      if (!conversion) {
        throw new Error(t.errors.unsupported);
      }

      conversionStartedAt = Date.now();
      setIsConverting(true);
      const startConversion = () =>
        convertFiles({
          files: jobFiles,
          inputType: detectedType,
          outputType: jobOutput,
          gifTrim,
          onProgress: setProgress
        });
      const result = await startConversion();
      await waitForMinimumElapsed(conversionStartedAt, minimumConversionLoaderMs);
      setProgress(1);

      const completedJob: ConversionJob = {
        id: `${Date.now()}`,
        files: jobFiles,
        inputType: detectedType,
        outputType: jobOutput,
        createdAt: new Date().toISOString(),
        status: "success",
        outputs: result.outputs
      };

      setLastJob(completedJob);
      await addHistory(completedJob);
      setConversionModalVisible(false);
      setTimeout(() => setShareConfirmJob(completedJob), 120);
    } catch (caught) {
      if (conversionStartedAt) {
        await waitForMinimumElapsed(conversionStartedAt, minimumConversionLoaderMs);
      }
      void recordInternalError(
        "error",
        [
          caught,
          {
            feature: "conversion",
            inputType: jobInput,
            outputType: jobOutput,
            files: jobFiles.map((file) => file.name)
          }
        ],
        "conversion.run"
      );
      const message = localizeConversionError(caught, t);
      const failedJob: ConversionJob = {
        id: `${Date.now()}`,
        files: jobFiles,
        inputType: jobInput,
        outputType: jobOutput,
        createdAt: new Date().toISOString(),
        status: "failed",
        error: message
      };
      setError(message);
      setLastJob(failedJob);
      await addHistory(failedJob);
    } finally {
      setIsConverting(false);
    }
  };

  const runPdfCompression = async (file: AppFile) => {
    let compressionStartedAt: number | null = null;
    let progressTimer: ReturnType<typeof setInterval> | null = null;

    setFiles([file]);
    setInputType("pdf");
    setOutputType(getAvailableOutputs("pdf")[0] ?? "jpg");
    setConversionModalVisible(false);
    setError(null);
    setProgress(0);
    setShareConfirmJob(null);

    try {
      const detectedType = detectFileTypeFromFile(file);
      if (detectedType !== "pdf") {
        throw new Error("ERR_TYPE_MISMATCH");
      }

      compressionStartedAt = Date.now();
      setIsConverting(true);
      setProgress(0.14);
      progressTimer = setInterval(() => {
        setProgress((current) => Math.min(0.92, current + 0.07));
      }, 180);

      const result = await compressPdfFile(file);
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      await waitForMinimumElapsed(compressionStartedAt, minimumConversionLoaderMs);
      setProgress(1);

      const completedJob: ConversionJob = {
        id: `${Date.now()}`,
        files: [file],
        inputType: "pdf",
        outputType: "pdf",
        createdAt: new Date().toISOString(),
        status: "success",
        outputs: [result.output],
        summary: compressionSummaryText(result, language)
      };

      setLastJob(completedJob);
      await addHistory(completedJob);
      setTimeout(() => setShareConfirmJob(completedJob), 120);
    } catch (caught) {
      if (compressionStartedAt) {
        await waitForMinimumElapsed(compressionStartedAt, minimumConversionLoaderMs);
      }
      void recordInternalError(
        "error",
        [caught, { feature: "pdfCompression", file: file.name }],
        "pdf.compress"
      );
      const message = localizeConversionError(caught, t);
      const failedJob: ConversionJob = {
        id: `${Date.now()}`,
        files: [file],
        inputType: "pdf",
        outputType: "pdf",
        createdAt: new Date().toISOString(),
        status: "failed",
        error: message
      };
      setError(message);
      setLastJob(failedJob);
      await addHistory(failedJob);
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      setIsConverting(false);
    }
  };

  const shareOutputs = async (job: ConversionJob | null = lastJob) => {
    if (!job?.outputs?.length) {
      Alert.alert(t.shareUnavailableTitle, t.shareUnavailableBody);
      return;
    }

    if (Platform.OS === "web") {
      if (shouldShareOutputsAsZip(job)) {
        const zipOutput = await createWebOutputZip(job.outputs);
        await addZippedOutput(zipOutput);
        const anchor = document.createElement("a");
        anchor.href = zipOutput.uri;
        anchor.download = zipOutput.name;
        anchor.click();
        return;
      }

      for (const output of job.outputs) {
        const anchor = document.createElement("a");
        anchor.href = output.uri;
        anchor.download = output.name;
        anchor.click();
      }
      return;
    }

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert(t.shareUnavailableTitle, t.shareUnavailableBody);
      return;
    }

    if (shouldShareOutputsAsZip(job)) {
      const zipOutput = await createNativeOutputZip(job.outputs);
      await addZippedOutput(zipOutput);
      await Sharing.shareAsync(zipOutput.uri, {
        dialogTitle: zipOutput.name,
        mimeType: "application/zip",
        UTI: "com.pkware.zip-archive"
      });
      return;
    }

    if (job.outputs.length > 1) {
      for (const output of job.outputs) {
        const shareUri = await prepareShareUri(output);
        await Sharing.shareAsync(shareUri, {
          dialogTitle: output.name,
          mimeType: output.mimeType,
          UTI: output.uti
        });
      }
      return;
    }

    const output = job.outputs[0];
    const shareUri = await prepareShareUri(output);
    await Sharing.shareAsync(shareUri, {
      dialogTitle: output.name,
      mimeType: output.mimeType,
      UTI: output.uti
    });
  };

  const confirmShareLatestOutput = async () => {
    const job = shareConfirmJob;
    if (!job) return;

    try {
      await shareOutputs(job);
      setShareConfirmJob(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t.shareUnavailableBody;
      Alert.alert(t.shareUnavailableTitle, message);
    }
  };

  const changeLanguage = (nextLanguage: Language) => {
    if (nextLanguage === language) {
      setLanguageModalVisible(false);
      return;
    }

    setLanguageModalVisible(false);
    setLanguageTransitionVisible(true);
    languageSwitchProgress.setValue(0);
    Animated.timing(languageSwitchProgress, {
      toValue: 1,
      duration: 920,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start();
    setTimeout(() => {
      setLanguage(nextLanguage);
    }, 520);
    setTimeout(() => setLanguageTransitionVisible(false), 980);
  };

  const openDocumentEditor = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
      type: ["application/pdf", "image/jpeg", "image/png", "text/plain"]
    });
    if (picked.canceled) return;

    const asset = picked.assets[0];
    const file: AppFile = {
      name: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType,
      size: asset.size ?? 0
    };

    await openDocumentEditorFile(file);
  };

  const openQuickActionPicker = (action: HomeQuickAction) => {
    if (action === "scanDocument") {
      void scanDocumentToPdf();
      return;
    }
    setQuickActionPicker(action);
  };

  const scanDocumentToPdf = async () => {
    if (isScanningDocument) return;

    if (Platform.OS === "web") {
      Alert.alert(t.errorTitle, t.errors.nativeRequired);
      return;
    }

    setIsScanningDocument(true);
    setError(null);

    try {
      const scannerModule = await import("react-native-document-scanner-plugin");
      const response = await scannerModule.default.scanDocument({
        croppedImageQuality: 96,
        maxNumDocuments: 10,
        responseType: scannerModule.ResponseType.ImageFilePath
      });

      if (response.status === scannerModule.ScanDocumentResponseStatus.Cancel) return;

      const scannedImages = response.scannedImages?.filter(Boolean) ?? [];
      if (scannedImages.length === 0) {
        Alert.alert(t.errorTitle, language === "tr" ? "Taranan belge bulunamadı." : "No scanned document was returned.");
        return;
      }

      const timestamp = Date.now();
      const scannedFiles = await Promise.all(
        scannedImages.map(async (uri, index) => {
          const normalizedUri = normalizeScannedImageUri(uri);
          const info = normalizedUri.startsWith("file://") ? await FileSystem.getInfoAsync(normalizedUri) : null;
          return {
            name: `editio_scan_${timestamp}_${index + 1}.jpg`,
            uri: normalizedUri,
            mimeType: "image/jpeg",
            size: info?.exists ? info.size ?? 0 : 0
          };
        })
      );

      await handleQuickActionFiles("createPdf", scannedFiles);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const needsNativeBuild =
        message.includes("DocumentScanner") ||
        message.includes("TurboModuleRegistry") ||
        message.includes("Native module") ||
        message.includes("Cannot find native module");
      Alert.alert(
        t.errorTitle,
        needsNativeBuild
          ? language === "tr"
            ? "Belge tarama modülü native build gerektiriyor. Uygulamayı iOS/Android development build olarak yeniden kurup tekrar deneyin."
            : "Document scanning requires a native development build. Rebuild the iOS/Android app and try again."
          : language === "tr"
            ? "Belge tarama başlatılamadı. Kamera iznini kontrol edip tekrar deneyin."
            : "Document scanning could not be started. Check camera permission and try again."
      );
    } finally {
      setIsScanningDocument(false);
    }
  };

  const pickQuickActionDocuments = async () => {
    const action = quickActionPicker;
    if (!action) return;
    setQuickActionPicker(null);
    await waitForModalDismiss();
    const picked = await DocumentPicker.getDocumentAsync({
      multiple: action === "createPdf" || action === "zipCreate",
      copyToCacheDirectory: true,
      type: quickActionDocumentTypes(action)
    });
    if (picked.canceled) return;
    await handleQuickActionFiles(
      action,
      picked.assets.map((asset) => ({
        name: asset.name,
        uri: asset.uri,
        mimeType: asset.mimeType,
        size: asset.size ?? 0
      }))
    );
  };

  const pickQuickActionGallery = async () => {
    const action = quickActionPicker;
    if (!action) return;
    setQuickActionPicker(null);
    await waitForModalDismiss();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t.permissionTitle, t.permissionGallery);
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: action === "createPdf" || action === "zipCreate",
      mediaTypes: quickActionGalleryMediaTypes(action),
      orderedSelection: true,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      quality: 1,
      selectionLimit: action === "createPdf" || action === "zipCreate" ? 0 : 1
    });
    if (picked.canceled) return;
    await handleQuickActionFiles(
      action,
      picked.assets.map((asset, index) => {
        const extension = extensionFromGalleryAsset(asset);
        return {
          name: asset.fileName ?? `gallery_${Date.now()}_${index}.${extension}`,
          uri: asset.uri,
          mimeType: asset.mimeType ?? mimeFromGalleryAsset(asset, extension),
          size: asset.fileSize ?? 0
        };
      })
    );
  };

  const handleQuickActionFiles = async (action: HomeQuickAction, selected: AppFile[]) => {
    if (!selected.length) return;

    if (action === "createPdf") {
      setActiveTab("convert");
      applyFiles(selected, "pdf");
      return;
    }

    if (action === "convertUdf") {
      setActiveTab("convert");
      applyFiles(selected.slice(0, 1), "pdf");
      return;
    }

    if (action === "compressPdf") {
      setActiveTab("convert");
      await runPdfCompression(selected[0]);
      return;
    }

    if (action === "exportPdf") {
      setActiveTab("convert");
      applyFiles(selected.slice(0, 1), "jpg");
      return;
    }

    if (action === "zipCreate") {
      setArchiveQuickIntent({ id: Date.now(), mode: "compress", files: selected, autoRun: true });
      setActiveTab("archive");
      return;
    }

    if (action === "zipOpen") {
      setArchiveQuickIntent({ id: Date.now(), mode: "extract", files: selected.slice(0, 1) });
      setActiveTab("archive");
      return;
    }

    if (action === "toMp3") {
      setActiveTab("convert");
      applyFiles(selected.slice(0, 1), "mp3");
      return;
    }

    if (action === "toMp4") {
      setActiveTab("convert");
      applyFiles(selected.slice(0, 1), "mp4");
      return;
    }

    setPendingEditorAction(action === "readAloud" ? "read" : action === "fillSign" ? "signature" : null);
    await openDocumentEditorFile(selected[0]);
  };

  const openDocumentEditorFile = async (file: AppFile) => {
    try {
      setIsEditorBusy(true);
      setEditorMessage(null);
      const info = await inspectEditableDocument(file);
      const previewSource = await createDocumentPreviewSource(file);
      setEditorFile(file);
      setEditorPreviewSource(previewSource);
      setEditorOutput(null);
      setEditorPageCount(info.pageCount);
      setEditorPageNumber(1);
      setEditorPagePlan(createSourcePagePlan(info.pageCount));
      setEditorLayers([]);
      setEditorRedoLayers([]);
      setSelectedEditorLayerId(null);
      setActiveEditorTool("select");
      setActiveTab("editor");
    } catch {
      Alert.alert(t.documentEditor.pickFailed, t.documentEditor.unsupported);
    } finally {
      setIsEditorBusy(false);
    }
  };

  useEffect(() => {
    if (!pendingEditorAction || activeTab !== "editor" || !editorFile || isEditorBusy) return;
    const action = pendingEditorAction;
    setPendingEditorAction(null);
    if (action === "signature") {
      setActiveEditorTool("select");
      setEditorMessage(t.documentEditor.addSignature);
      return;
    }
    setTimeout(() => {
      void readEditorDocumentAloud();
    }, 360);
  }, [activeTab, editorFile, isEditorBusy, pendingEditorAction, t.documentEditor.addSignature]);

  const applyEditorChanges = async () => {
    if (!editorFile) return;

    const startedAt = Date.now();
    try {
      setIsEditorBusy(true);
      setEditorApplyProgress(0.18);
      setEditorResultModalVisible(false);
      setEditorMessage(null);
      const result = await applyDocumentEdits({
        file: editorFile,
        layers: editorLayers,
        pagePlan: editorPagePlan
      });
      setEditorApplyProgress(0.82);
      const nextFile = {
        name: result.output.name,
        uri: result.output.uri,
        mimeType: result.output.mimeType,
        size: 0
      };
      const previewSource = await createDocumentPreviewSource(nextFile);
      await waitForMinimumElapsed(startedAt, minimumConversionLoaderMs);
      setEditorApplyProgress(1);
      setEditorOutput(result.output);
      setEditorFile(nextFile);
      setEditorPreviewSource(previewSource);
      setEditorPageCount(result.pageCount);
      setEditorPagePlan(createSourcePagePlan(result.pageCount));
      setEditorLayers([]);
      setEditorRedoLayers([]);
      setSelectedEditorLayerId(null);
      setActiveEditorTool("select");
      setEditorMessage(t.documentEditor.ready);
      setEditorResultModalVisible(true);
    } catch (caught) {
      const message = caught instanceof Error && caught.message.includes("ERR_EDITOR_EMPTY")
        ? t.documentEditor.empty
        : t.documentEditor.pickFailed;
      setEditorMessage(message);
    } finally {
      setIsEditorBusy(false);
      setEditorApplyProgress(0);
    }
  };

  const addBlankEditorPage = () => {
    if (editorPagePlan.length >= 10) {
      Alert.alert(t.documentEditor.pageLimitTitle, t.documentEditor.pageLimitBody);
      return;
    }

    const insertIndex = Math.max(0, editorPageNumber);
    const nextPage: DocumentPagePlanItem = {
      id: `blank_${Date.now()}`,
      blank: true,
      sourcePage: editorPagePlan[Math.max(0, editorPageNumber - 1)]?.sourcePage ?? 1
    };
    setEditorPagePlan((current) => {
      const next = [...current.slice(0, insertIndex), nextPage, ...current.slice(insertIndex)];
      setEditorPageCount(next.length);
      return next;
    });
    setEditorLayers((current) =>
      current.map((layer) => (layer.page > editorPageNumber ? { ...layer, page: layer.page + 1 } : layer))
    );
    setEditorPageNumber(editorPageNumber + 1);
    setSelectedEditorLayerId(null);
    setEditorRedoLayers([]);
    setEditorMessage(t.documentEditor.blankPageAdded);
  };

  const deleteEditorPage = () => {
    if (editorPagePlan.length <= 1) {
      Alert.alert(t.documentEditor.deletePageBlockedTitle, t.documentEditor.deletePageBlockedBody);
      return;
    }

    const deletedPage = editorPageNumber;
    const nextPageNumber = Math.min(deletedPage, editorPagePlan.length - 1);
    setEditorPagePlan((current) => {
      const next = current.filter((_, index) => index + 1 !== deletedPage);
      setEditorPageCount(Math.max(1, next.length));
      return next;
    });
    setEditorLayers((current) =>
      current
        .filter((layer) => layer.page !== deletedPage)
        .map((layer) => (layer.page > deletedPage ? { ...layer, page: layer.page - 1 } : layer))
    );
    setEditorPageNumber(nextPageNumber);
    setSelectedEditorLayerId(null);
    setEditorRedoLayers([]);
    setEditorMessage(t.documentEditor.pageRemoved);
  };

  const addEditorLayer = (type: "text" | "typedSignature" | "qrSignature") => {
    const isQr = type === "qrSignature";
    const isTypedSignature = type === "typedSignature";
    const nextLayer: DocumentEditLayer = {
      id: `${type}_${Date.now()}`,
      type,
      text: type === "typedSignature" ? t.documentEditor.addSignature : type === "qrSignature" ? `${editorFile?.name ?? "Editio"} ${Date.now()}` : t.documentEditor.textPlaceholder,
      page: editorPageNumber,
      x: isQr ? 0.41 : 0.34,
      y: isQr ? 0.38 : 0.3,
      width: isQr ? 0.18 : isTypedSignature ? 0.28 : 0.3,
      height: isQr ? 0.18 : isTypedSignature ? 0.09 : 0.08,
      color: editorStrokeColor,
      lineWidth: editorStrokeWidth,
      fontSize: type === "typedSignature" ? 20 : 13,
      textAlign: "center",
      backgroundColor: "transparent",
      fontStyle: type === "typedSignature" ? "italic" : "normal",
      fontWeight: type === "typedSignature" ? "900" : "700",
      fontFamily: type === "typedSignature" ? "script" : "sans"
    };
    setEditorLayers((current) => [...current, nextLayer]);
    setEditorRedoLayers([]);
    setSelectedEditorLayerId(nextLayer.id);
    setEditorMessage(null);
    setActiveEditorTool("select");
  };

  const rememberDrawnSignature = (points: Array<{ x: number; y: number; move?: boolean }>) => {
    const nextSignature: SavedDrawnSignature = {
      id: `savedSignature_${Date.now()}`,
      points
    };
    setSavedDrawnSignatures((current) => {
      const next = [nextSignature, ...current].slice(0, 3);
      void AsyncStorage.setItem(savedSignaturesStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const deleteSavedDrawnSignature = (id: string) => {
    setSavedDrawnSignatures((current) => {
      const next = current.filter((signature) => signature.id !== id);
      void AsyncStorage.setItem(savedSignaturesStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const addDrawnSignatureLayer = (points: Array<{ x: number; y: number; move?: boolean }>, shouldRemember = true) => {
    const fittedSignature = fitSignaturePoints(points);
    const nextLayer: DocumentEditLayer = {
      id: `inkSignature_${Date.now()}`,
      type: "inkSignature",
      text: "Signature",
      page: editorPageNumber,
      x: 0.36,
      y: 0.34,
      width: fittedSignature.width,
      height: fittedSignature.height,
      points: fittedSignature.points,
      color: "#111827",
      lineWidth: 3,
      backgroundColor: "transparent"
    };
    setEditorLayers((current) => [...current, nextLayer]);
    setEditorRedoLayers([]);
    setSelectedEditorLayerId(nextLayer.id);
    setEditorMessage(null);
    setActiveEditorTool("select");
    if (shouldRemember) rememberDrawnSignature(points);
  };

  const addImageSignatureLayer = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t.permissionTitle, t.permissionGallery);
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: false,
      mediaTypes: ["images"],
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      quality: 1
    });
    if (picked.canceled) return;

    const asset = picked.assets[0];
    const extension = extensionFromGalleryAsset(asset);
    const nextLayer: DocumentEditLayer = {
      id: `imageSignature_${Date.now()}`,
      type: "imageSignature",
      text: asset.fileName ?? "Signature",
      page: editorPageNumber,
      x: 0.5,
      y: 0.7,
      width: 0.38,
      height: 0.16,
      imageUri: asset.uri,
      imageMimeType: asset.mimeType ?? mimeFromGalleryAsset(asset, extension),
      backgroundColor: "transparent"
    };
    setEditorLayers((current) => [...current, nextLayer]);
    setEditorRedoLayers([]);
    setSelectedEditorLayerId(nextLayer.id);
    setEditorMessage(null);
    setActiveEditorTool("select");
  };

  const addQrSignatureLayer = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t.permissionTitle, t.permissionGallery);
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: false,
      mediaTypes: ["images"],
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      quality: 1
    });
    if (picked.canceled) return;

    const asset = picked.assets[0];
    const extension = extensionFromGalleryAsset(asset);
    const nextLayer: DocumentEditLayer = {
      id: `qrSignature_${Date.now()}`,
      type: "qrSignature",
      text: asset.fileName ?? "QR",
      page: editorPageNumber,
      x: 0.39,
      y: 0.34,
      width: 0.22,
      height: 0.22,
      imageUri: asset.uri,
      imageMimeType: asset.mimeType ?? mimeFromGalleryAsset(asset, extension),
      backgroundColor: "transparent"
    };
    setEditorLayers((current) => [...current, nextLayer]);
    setEditorRedoLayers([]);
    setSelectedEditorLayerId(nextLayer.id);
    setEditorMessage(null);
    setActiveEditorTool("select");
  };

  const commitEditorStroke = (points: Array<{ x: number; y: number; move?: boolean }>, tool: EditorTool) => {
    if (tool === "select") return;
    if (tool === "eraser") {
      const eraserRadius = Math.max(0.018, editorStrokeWidth / 360);
      setEditorLayers((current) => {
        let didErase = false;
        const next = current.flatMap((layer) => {
          if (layer.page !== editorPageNumber || (layer.type !== "pen" && layer.type !== "highlight")) return [layer];
          const erasedLayers = eraseStrokeLayer(layer, points, eraserRadius);
          if (erasedLayers.length !== 1 || erasedLayers[0] !== layer) didErase = true;
          return erasedLayers;
        });
        if (didErase) {
          setEditorRedoLayers([]);
          setSelectedEditorLayerId(null);
        }
        return next;
      });
      setActiveEditorTool("eraser");
      return;
    }

    const layerType: DocumentEditLayer["type"] = tool;
    const nextLayer: DocumentEditLayer = {
      id: `${tool}_${Date.now()}`,
      type: layerType,
      text: "",
      page: editorPageNumber,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      points,
      color: editorStrokeColor,
      lineWidth: tool === "highlight" ? Math.max(10, editorStrokeWidth * 2) : editorStrokeWidth
    };
    setEditorLayers((current) => [...current, nextLayer]);
    setEditorRedoLayers([]);
    setSelectedEditorLayerId(nextLayer.id);
  };

  const updateSelectedEditorLayerText = (value: string) => {
    if (!selectedEditorLayerId) return;
    setEditorLayers((current) =>
      current.map((layer) => (layer.id === selectedEditorLayerId ? { ...layer, text: value } : layer))
    );
  };

  const nudgeSelectedEditorLayer = (dx: number, dy: number) => {
    if (!selectedEditorLayerId) return;
    setEditorLayers((current) =>
      current.map((layer) =>
        layer.id === selectedEditorLayerId
          ? {
              ...layer,
              x: Math.max(0.02, Math.min(0.96 - layer.width, layer.x + dx)),
              y: Math.max(0.02, Math.min(0.96 - layer.height, layer.y + dy))
            }
          : layer
      )
    );
  };

  const moveEditorLayer = (id: string, x: number, y: number) => {
    setEditorLayers((current) =>
      current.map((layer) =>
        layer.id === id
          ? {
              ...layer,
              x: Math.max(0.01, Math.min(0.99 - layer.width, x)),
              y: Math.max(0.01, Math.min(0.99 - layer.height, y))
            }
          : layer
      )
    );
  };

  const resizeEditorLayer = (id: string, width: number, height: number) => {
    setEditorLayers((current) =>
      current.map((layer) =>
        layer.id === id
          ? {
              ...layer,
              width: Math.max(0.12, Math.min(0.99 - layer.x, width)),
              height: Math.max(0.06, Math.min(0.99 - layer.y, height))
            }
          : layer
      )
    );
  };

  const rotateEditorLayer = (id: string, rotation: number) => {
    setEditorLayers((current) =>
      current.map((layer) =>
        layer.id === id
          ? {
              ...layer,
              rotation
            }
          : layer
      )
    );
  };

  const updateEditorLayerStyle = (
    id: string,
    patch: Partial<Pick<DocumentEditLayer, "backgroundColor" | "fontSize" | "textAlign" | "fontStyle" | "fontWeight" | "fontFamily" | "textDecorationLine">>
  ) => {
    setEditorLayers((current) => current.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  };

  const deleteSelectedEditorLayer = (targetLayerId?: string) => {
    const layerId = targetLayerId ?? selectedEditorLayerId;
    if (!layerId) return;
    setEditorLayers((current) => current.filter((layer) => layer.id !== layerId));
    setEditorRedoLayers([]);
    setSelectedEditorLayerId(null);
  };

  const undoEditorLayer = () => {
    setEditorLayers((current) => {
      if (current.length === 0) return current;
      const removed = current[current.length - 1];
      setEditorRedoLayers((redo) => [removed, ...redo]);
      setSelectedEditorLayerId(null);
      return current.slice(0, -1);
    });
  };

  const redoEditorLayer = () => {
    setEditorRedoLayers((current) => {
      const [restored, ...rest] = current;
      if (!restored) return current;
      setEditorLayers((layers) => [...layers, restored]);
      setSelectedEditorLayerId(restored.id);
      return rest;
    });
  };

  const shareEditedDocument = async () => {
    if (!editorOutput) {
      Alert.alert(t.shareUnavailableTitle, t.shareUnavailableBody);
      return;
    }
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert(t.shareUnavailableTitle, t.shareUnavailableBody);
      return;
    }
    const shareUri = await prepareShareUri(editorOutput);
    await Sharing.shareAsync(shareUri, {
      dialogTitle: editorOutput.name,
      mimeType: editorOutput.mimeType,
      UTI: editorOutput.uti
    });
  };

  const shareEditedDocumentFromModal = () => {
    setEditorResultModalVisible(false);
    setTimeout(() => {
      void shareEditedDocument();
    }, 260);
  };

  const closeDocumentEditor = () => {
    shouldRestartReadingOnPageChange.current = false;
    Speech.stop();
    setIsReadingDocument(false);
    setActiveTab("convert");
  };

  const speakCurrentEditorPage = async () => {
    if (!editorFile) return;

    try {
      Speech.stop();
      setEditorMessage(t.documentEditor.preparingText);
      const currentPlan = editorPagePlan[editorPageNumber - 1];
      const sourcePageNumber = currentPlan?.blank ? undefined : currentPlan?.sourcePage ?? editorPageNumber;
      const extractedText = sourcePageNumber ? await extractEditableDocumentText(editorFile, sourcePageNumber) : "";
      const annotationText = editorLayers
        .filter((layer) => layer.page === editorPageNumber && (layer.type === "text" || layer.type === "typedSignature"))
        .map((layer) => layer.text)
        .join(" ");
      const textToRead = [extractedText, annotationText].filter(Boolean).join("\n\n").trim();
      if (!textToRead) {
        Alert.alert(t.documentEditor.noReadableTextTitle, t.documentEditor.noReadableTextPage.replace("{page}", String(editorPageNumber)));
        setIsReadingDocument(false);
        setEditorMessage(null);
        return;
      }

      setIsReadingDocument(true);
      setEditorMessage(t.documentEditor.reading);
      Speech.speak(textToRead.slice(0, 3900), {
        language: speechLocale,
        voice: speechVoiceIdentifier ?? undefined,
        rate: speechRate,
        pitch: 1.02,
        onDone: () => {
          shouldRestartReadingOnPageChange.current = false;
          setIsReadingDocument(false);
          setEditorMessage(null);
        },
        onStopped: () => {
          if (!shouldRestartReadingOnPageChange.current) setIsReadingDocument(false);
          setEditorMessage(null);
        },
        onError: () => {
          shouldRestartReadingOnPageChange.current = false;
          setIsReadingDocument(false);
          setEditorMessage(null);
        }
      });
    } catch (error) {
      console.warn("Read aloud failed", error);
      setIsReadingDocument(false);
      setEditorMessage(null);
      Alert.alert(t.documentEditor.noReadableTextTitle, t.documentEditor.readFailedBody);
    }
  };

  const readEditorDocumentAloud = async () => {
    if (isReadingDocument) {
      shouldRestartReadingOnPageChange.current = false;
      Speech.stop();
      setIsReadingDocument(false);
      setEditorMessage(null);
      return;
    }
    shouldRestartReadingOnPageChange.current = true;
    await speakCurrentEditorPage();
  };

  useEffect(() => {
    if (!isReadingDocument || !shouldRestartReadingOnPageChange.current) return;
    const timer = setTimeout(() => {
      void speakCurrentEditorPage();
    }, 180);
    return () => clearTimeout(timer);
  }, [editorPageNumber, editorPagePlan]);

  useEffect(() => {
    if (!gifTrimVisible) {
      gifPlayer.pause();
      setGifThumbnails([]);
      return;
    }

    const timer = setInterval(() => {
      const duration = Number.isFinite(gifPlayer.duration) ? gifPlayer.duration : 0;
      if (duration > 0) setGifVideoDuration(duration);
      const currentTime = Number.isFinite(gifPlayer.currentTime) ? gifPlayer.currentTime : 0;
      setGifCurrentSeconds(currentTime);
      if (currentTime > gifStartSeconds + gifDurationSeconds) {
        gifPlayer.currentTime = gifStartSeconds;
        gifPlayer.pause();
      }
    }, 300);

    return () => clearInterval(timer);
  }, [gifDurationSeconds, gifPlayer, gifStartSeconds, gifTrimVisible]);

  useEffect(() => {
    if (!gifTrimVisible || gifVideoDuration <= 0) return;

    let cancelled = false;
    const createThumbnails = async () => {
      try {
        setIsGeneratingGifThumbnails(true);
        const frameCount = 12;
        const times = Array.from({ length: frameCount }, (_, index) =>
          Math.min(Math.max(0, gifVideoDuration - 0.05), (gifVideoDuration * index) / frameCount)
        );
        const thumbnails = await gifPlayer.generateThumbnailsAsync(times, { maxWidth: 120 });
        if (cancelled) return;
        setGifThumbnails(
          thumbnails.map((thumbnail, index) => ({
            id: `${index}-${thumbnail.requestedTime}`,
            source: thumbnail
          }))
        );
      } catch {
        if (!cancelled) setGifThumbnails([]);
      } finally {
        if (!cancelled) setIsGeneratingGifThumbnails(false);
      }
    };

    const thumbnailTimer = setTimeout(() => {
      void createThumbnails();
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(thumbnailTimer);
    };
  }, [gifPlayer, gifTrimVisible, gifVideoDuration]);

  return (
    <SafeAreaProvider>
      <SafeAreaView edges={["top", "left", "right"]} style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
        <StatusBar barStyle={theme.isDark ? "light-content" : "dark-content"} />
        <Modal
          transparent
          animationType="fade"
          visible={isEditorBusy}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.editorLoaderWrap}>
              <ConversionLoader
                progress={editorApplyProgress}
                theme={theme}
                label={t.documentEditor.createLoaderLabel}
                letterText={t.generating}
                subtitle={t.preparingOutput}
              />
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="fade"
          visible={settingsDocumentVisible}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
          onRequestClose={closeSettingsDocument}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.legalModal,
                isLandscape && styles.legalModalLandscape,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }
              ]}
            >
              {activeSettingsDocument ? (
                <>
                  <View style={styles.legalHeader}>
                    <View style={[styles.legalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                      <Feather name={activeSettingsDocument.icon} size={20} color={theme.colors.primary} />
                    </View>
                    <View style={styles.legalTitleColumn}>
                      <Text style={[styles.legalTitle, { color: theme.colors.text }]}>
                        {activeSettingsDocument.title}
                      </Text>
                      <Text style={[styles.legalSubtitle, { color: theme.colors.muted }]}>
                        {activeSettingsDocument.subtitle}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.legalCloseButton, { backgroundColor: theme.colors.surfaceAlt }]}
                      onPress={closeSettingsDocument}
                    >
                      <Feather name="x" size={18} color={theme.colors.muted} />
                    </TouchableOpacity>
                  </View>
                  <ScrollView
                    style={styles.legalScroll}
                    contentContainerStyle={styles.legalScrollContent}
                    showsVerticalScrollIndicator={false}
                  >
                    {activeSettingsDocument.sections.map((section) => (
                      <View key={section.title} style={styles.legalSection}>
                        <Text style={[styles.legalSectionTitle, { color: theme.colors.text }]}>
                          {section.title}
                        </Text>
                        {section.body.map((paragraph) => (
                          <Text key={paragraph} style={[styles.legalParagraph, { color: theme.colors.muted }]}>
                            {paragraph}
                          </Text>
                        ))}
                      </View>
                    ))}
                  </ScrollView>
                </>
              ) : null}
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="fade"
          visible={showInternalDiagnostics && diagnosticsVisible}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
          onRequestClose={() => setDiagnosticsVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.legalModal,
                isLandscape && styles.legalModalLandscape,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }
              ]}
            >
              <View style={styles.legalHeader}>
                <View style={[styles.legalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Feather name="activity" size={20} color={theme.colors.primary} />
                </View>
                <View style={styles.legalTitleColumn}>
                  <Text style={[styles.legalTitle, { color: theme.colors.text }]}>{t.diagnosticsTitle}</Text>
                  <Text style={[styles.legalSubtitle, { color: theme.colors.muted }]}>
                    {diagnosticEntries.length} {t.diagnosticsCaptured}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.legalCloseButton, { backgroundColor: theme.colors.surfaceAlt }]}
                  onPress={() => setDiagnosticsVisible(false)}
                >
                  <Feather name="x" size={18} color={theme.colors.muted} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.diagnosticsIntro, { color: theme.colors.muted }]}>
                {t.diagnosticsSubtitle}
              </Text>
              <ScrollView
                style={styles.legalScroll}
                contentContainerStyle={styles.legalScrollContent}
                showsVerticalScrollIndicator={false}
              >
                {diagnosticEntries.length === 0 ? (
                  <View style={[styles.diagnosticsEmpty, { backgroundColor: theme.colors.surfaceAlt }]}>
                    <Feather name="check-circle" size={24} color={theme.colors.success} />
                    <Text style={[styles.diagnosticsEmptyText, { color: theme.colors.muted }]}>
                      {t.diagnosticsEmpty}
                    </Text>
                  </View>
                ) : (
                  diagnosticEntries.map((entry) => (
                    <View
                      key={entry.id}
                      style={[
                        styles.diagnosticsEntry,
                        { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }
                      ]}
                    >
                      <View style={styles.diagnosticsMetaRow}>
                        <Text
                          style={[
                            styles.diagnosticsLevel,
                            {
                              color:
                                entry.level === "fatal" || entry.level === "error"
                                  ? theme.colors.danger
                                  : entry.level === "warn"
                                    ? theme.colors.accent
                                    : theme.colors.success
                            }
                          ]}
                        >
                          {entry.level.toUpperCase()}
                        </Text>
                        <Text style={[styles.diagnosticsDate, { color: theme.colors.muted }]}>
                          {new Date(entry.createdAt).toLocaleString()}
                        </Text>
                      </View>
                      <Text style={[styles.diagnosticsSource, { color: theme.colors.primary }]}>
                        {entry.source} · {entry.runtime.platform} {entry.runtime.osVersion}
                      </Text>
                      <Text style={[styles.diagnosticsMessage, { color: theme.colors.text }]} numberOfLines={4}>
                        {entry.message}
                      </Text>
                      {entry.stack ? (
                        <Text style={[styles.diagnosticsStack, { color: theme.colors.muted }]} numberOfLines={5}>
                          {entry.stack}
                        </Text>
                      ) : null}
                    </View>
                  ))
                )}
              </ScrollView>
              <View style={styles.diagnosticsActions}>
                <TouchableOpacity
                  style={[styles.actionCancelButton, { borderColor: theme.colors.border }]}
                  onPress={clearDiagnostics}
                >
                  <Text style={[styles.actionCancelText, { color: theme.colors.text }]}>
                    {t.diagnosticsClear}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionPrimaryButton} onPress={shareDiagnostics}>
                  <InstagramGradient theme={theme} style={styles.actionPrimaryGradient}>
                    <Text style={styles.actionPrimaryText}>{t.diagnosticsShare}</Text>
                  </InstagramGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="fade"
          visible={editorResultModalVisible}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
          onRequestClose={() => setEditorResultModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.actionModal, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.actionModalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Feather name="check-circle" size={22} color={theme.colors.primary} />
              </View>
              <Text style={[styles.actionModalTitle, { color: theme.colors.text }]}>{t.documentEditor.resultTitle}</Text>
              <Text style={[styles.actionModalBody, { color: theme.colors.muted }]}>
                {t.documentEditor.resultBody}
              </Text>
              <View style={styles.actionModalButtons}>
                <TouchableOpacity
                  style={[styles.actionCancelButton, { borderColor: theme.colors.border }]}
                  onPress={() => setEditorResultModalVisible(false)}
                >
                  <Text style={[styles.actionCancelText, { color: theme.colors.text }]}>{t.documentEditor.close}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionPrimaryButton}
                  onPress={shareEditedDocumentFromModal}
                >
                  <InstagramGradient theme={theme} style={styles.actionPrimaryGradient}>
                    <Text style={styles.actionPrimaryText}>{t.share}</Text>
                  </InstagramGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="fade"
          visible={Boolean(renameTarget)}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
          onRequestClose={() => setRenameTarget(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.actionModal, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.actionModalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Feather name="edit-3" size={22} color={theme.colors.primary} />
              </View>
              <Text style={[styles.actionModalTitle, { color: theme.colors.text }]}>{t.renameFileTitle}</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                value={renameInput}
                onChangeText={setRenameInput}
                placeholder={t.renameFilePlaceholder}
                placeholderTextColor={theme.colors.muted}
                style={[
                  styles.renameInput,
                  {
                    backgroundColor: theme.colors.surfaceAlt,
                    borderColor: theme.colors.border,
                    color: theme.colors.text
                  }
                ]}
              />
              <View style={styles.actionModalButtons}>
                <TouchableOpacity
                  style={[styles.actionCancelButton, { borderColor: theme.colors.border }]}
                  onPress={() => setRenameTarget(null)}
                >
                  <Text style={[styles.actionCancelText, { color: theme.colors.text }]}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionPrimaryButton}
                  onPress={confirmRenameFile}
                >
                  <InstagramGradient theme={theme} style={styles.actionPrimaryGradient}>
                    <Text style={[styles.actionPrimaryText, { color: theme.colors.onPrimary }]}>{t.save}</Text>
                  </InstagramGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="fade"
          visible={Boolean(shareConfirmJob)}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
          onRequestClose={() => setShareConfirmJob(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.actionModal, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.actionModalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Feather name="share-2" size={22} color={theme.colors.primary} />
              </View>
              <Text style={[styles.actionModalTitle, { color: theme.colors.text }]}>{t.shareModalTitle}</Text>
              <Text style={[styles.actionModalBody, { color: theme.colors.muted }]}>
                {shareModalBodyText(shareConfirmJob, t)}
              </Text>
              <View style={styles.actionModalButtons}>
                <TouchableOpacity
                  style={[styles.actionCancelButton, { borderColor: theme.colors.border }]}
                  onPress={() => setShareConfirmJob(null)}
                >
                  <Text style={[styles.actionCancelText, { color: theme.colors.text }]}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionPrimaryButton}
                  onPress={() => void confirmShareLatestOutput()}
                >
                  <InstagramGradient theme={theme} style={styles.actionPrimaryGradient}>
                    <Text style={styles.actionPrimaryText}>{t.shareLatest}</Text>
                  </InstagramGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="none"
          visible={Boolean(quickActionPicker)}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
          onRequestClose={() => setQuickActionPicker(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.actionModal, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.actionModalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Feather name={quickActionPickerItem.icon} size={22} color={theme.colors.primary} />
              </View>
              <Text style={[styles.actionModalTitle, { color: theme.colors.text }]}>
                {quickActionPickerItem.title}
              </Text>
              <Text style={[styles.actionModalBody, { color: theme.colors.muted }]}>
                {quickActionPickerItem.body}
              </Text>
              <View style={styles.actionModalButtons}>
                <TouchableOpacity
                  style={[styles.actionCancelButton, { borderColor: theme.colors.border }]}
                  onPress={() => setQuickActionPicker(null)}
                >
                  <Text style={[styles.actionCancelText, { color: theme.colors.text }]}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionPrimaryButton}
                  onPress={() => void pickQuickActionDocuments()}
                >
                  <InstagramGradient theme={theme} style={styles.actionPrimaryGradient}>
                    <Text style={styles.actionPrimaryText}>{t.chooseFiles}</Text>
                  </InstagramGradient>
                </TouchableOpacity>
              </View>
              {quickActionCanUseGallery ? (
                <TouchableOpacity
                  style={[styles.quickGalleryButton, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}
                  onPress={() => void pickQuickActionGallery()}
                >
                  <Feather name="image" size={16} color={theme.colors.primary} />
                  <Text style={[styles.quickGalleryText, { color: theme.colors.text }]}>{t.chooseGallery}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="fade"
          visible={languageModalVisible}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
          onRequestClose={() => setLanguageModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.languageModal, isLandscape && styles.languageModalLandscape, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={styles.languageModalHeader}>
                <View style={[styles.actionModalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Feather name="globe" size={22} color={theme.colors.primary} />
                </View>
                <View style={styles.convertModalTitleWrap}>
                  <Text style={[styles.actionModalTitle, styles.convertModalTitle, { color: theme.colors.text }]}>
                    {t.languageTitle}
                  </Text>
                  <Text style={[styles.errorText, { color: theme.colors.muted }]}>{t.chooseLanguage}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.convertModalClose, { backgroundColor: theme.colors.surfaceAlt }]}
                  onPress={() => setLanguageModalVisible(false)}
                >
                  <Feather name="x" size={18} color={theme.colors.muted} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={isLandscape ? styles.languageListScrollLandscape : undefined}
                contentContainerStyle={[styles.languageList, isLandscape && styles.languageListLandscape]}
                showsVerticalScrollIndicator={false}
              >
                {languageOptions.map((item) => {
                  const selected = item.code === language;
                  return (
                    <TouchableOpacity
                      key={item.code}
                      style={[
                        styles.languageRow,
                        isLandscape && styles.languageRowLandscape,
                        {
                          backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                          borderColor: selected ? theme.colors.primary : theme.colors.border
                        }
                      ]}
                      onPress={() => changeLanguage(item.code)}
                    >
                      <Text style={[styles.languageFlag, isLandscape && styles.languageFlagLandscape]}>{item.flag}</Text>
                      <View style={styles.languageTextWrap}>
                        <Text style={[styles.languageName, { color: theme.colors.text }]}>{item.nativeName}</Text>
                        <Text style={[styles.languageMeta, { color: theme.colors.muted }]}>{item.englishName}</Text>
                      </View>
                      {selected ? <Feather name="check" size={18} color={theme.colors.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="fade"
          visible={languageTransitionVisible}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        >
          <View style={[styles.languageTransitionOverlay, { backgroundColor: theme.colors.background }]}>
            <View style={styles.languageTransitionContent}>
              <View style={styles.languageTransitionLogo}>
                <Image source={mainBrandVisual} style={styles.languageTransitionLogoImage} contentFit="contain" />
              </View>
              <Text style={[styles.languageTransitionTitle, { color: theme.colors.text }]}>{t.appKicker}</Text>
              <Text style={[styles.languageTransitionText, { color: theme.colors.muted }]}>{t.languageChanging}</Text>
              <View style={[styles.languageTransitionTrack, { backgroundColor: theme.colors.border }]}>
                <Animated.View style={[styles.languageTransitionFill, { width: languageSwitchWidth }]}>
                  <InstagramGradient theme={theme} style={styles.languageTransitionFillGradient} />
                </Animated.View>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="slide"
          visible={conversionModalVisible}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
          onRequestClose={() => {
            if (!isConverting) setConversionModalVisible(false);
          }}
        >
          <View style={styles.sheetOverlay}>
            <View
              style={[
                styles.convertModal,
                isLandscape && styles.convertModalLandscape,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }
              ]}
            >
              <View style={styles.convertModalHeader}>
                <View style={[styles.actionModalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Feather name="shuffle" size={22} color={theme.colors.primary} />
                </View>
                <View style={styles.convertModalTitleWrap}>
                  <Text style={[styles.actionModalTitle, styles.convertModalTitle, { color: theme.colors.text }]}>
                    {t.convert}
                  </Text>
                  <Text style={[styles.errorText, { color: theme.colors.muted }]}>
                    {files.length} {t.selectedFiles.toLowerCase()}
                  </Text>
                </View>
                <TouchableOpacity
                  disabled={isConverting}
                  style={[styles.convertModalClose, { backgroundColor: theme.colors.surfaceAlt }]}
                  onPress={() => setConversionModalVisible(false)}
                >
                  <Feather name="x" size={18} color={theme.colors.muted} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalFileList}>
                {files.slice(0, 3).map((file) => (
                  <View
                    key={file.uri}
                    style={[styles.modalFileRow, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}
                  >
                    <View style={[styles.modalFileIcon, { backgroundColor: theme.colors.primarySoft }]}>
                      <Feather name="file-text" size={16} color={theme.colors.primary} />
                    </View>
                    <Text numberOfLines={1} style={[styles.modalFileName, { color: theme.colors.text }]}>
                      {file.name}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={[styles.modalPickerRow, isLandscape && styles.modalPickerRowLandscape]}>
                <View style={styles.modalPickerGroup}>
                  <Text style={[styles.gifInputLabel, { color: theme.colors.muted }]}>{t.detectedType}</Text>
                  <View style={[styles.modalDetectedBox, isLandscape && styles.modalDetectedBoxLandscape, { borderColor: theme.colors.border }]}>
                    <Text style={[styles.modalDetectedText, { color: theme.colors.text }]}>
                      {files.length > 0 ? inputType.toUpperCase() : t.waitingForFile}
                    </Text>
                  </View>
                </View>
                <View style={styles.modalPickerGroup}>
                  <Text style={[styles.gifInputLabel, { color: theme.colors.muted }]}>{t.outputType}</Text>
                  <View style={[styles.modalPickerShell, isLandscape && styles.modalPickerShellLandscape, { borderColor: theme.colors.border }]}>
                    <Picker
                      dropdownIconColor={theme.colors.text}
                      itemStyle={{ color: theme.colors.text, fontSize: isLandscape ? 15 : undefined }}
                      selectedValue={selectedOutputType}
                      onValueChange={setOutputType}
                      style={[
                        { color: theme.colors.text, backgroundColor: theme.colors.surface },
                        isLandscape && styles.modalPickerNativeLandscape
                      ]}
                    >
                      {availableOutputs.map((type) => (
                        <Picker.Item key={type} label={type.toUpperCase()} value={type} />
                      ))}
                    </Picker>
                  </View>
                </View>
              </View>

              {error ? (
                <View style={[styles.modalErrorBox, { backgroundColor: theme.colors.dangerSoft }]}>
                  <Text style={[styles.errorText, { color: theme.colors.danger }]}>{error}</Text>
                </View>
              ) : null}

              <ProgressBar progress={progress} theme={theme} label={t.progressLabel} />

              <TouchableOpacity
                disabled={isConverting || isPreparingSelection}
                style={styles.convertModalButtonClip}
                onPress={handleConvertPress}
              >
                <InstagramGradient theme={theme} style={[styles.convertModalButton, isLandscape && styles.convertModalButtonLandscape]}>
                  <View style={styles.convertModalButtonIcon}>
                    <Animated.View style={{ transform: [{ rotate: convertRotate }] }}>
                      <Feather name={isConverting ? "loader" : "plus"} size={22} color="#fff" />
                    </Animated.View>
                  </View>
                  <Text style={styles.convertModalButtonText}>
                    {isConverting ? `${t.converting}...` : t.convert}
                  </Text>
                </InstagramGradient>
              </TouchableOpacity>

            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="none"
          visible={showPrepareNotice}
          presentationStyle="overFullScreen"
          statusBarTranslucent
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        >
          <Animated.View
            style={[
              styles.fullscreenLoaderOverlay,
              isLandscape && styles.fullscreenLoaderOverlayLandscape,
              { opacity: prepareNoticeAnim }
            ]}
          >
            <View style={[styles.fullscreenLoaderWrap, isLandscape && styles.fullscreenLoaderWrapLandscape]}>
              <ConversionLoader
                progress={preparationProgress}
                theme={theme}
                label={t.preparingSelectionTitle}
                letterText={t.generating}
                subtitle={t.preparingSelectionSubtitle}
              />
            </View>
          </Animated.View>
        </Modal>
        <Modal
          transparent
          animationType="fade"
          visible={isConverting}
          presentationStyle="overFullScreen"
          statusBarTranslucent
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        >
          <View style={[styles.fullscreenLoaderOverlay, isLandscape && styles.fullscreenLoaderOverlayLandscape]}>
            <View style={[styles.fullscreenLoaderWrap, isLandscape && styles.fullscreenLoaderWrapLandscape]}>
              <ConversionLoader
                progress={progress}
                theme={theme}
                label={`${t.converting}...`}
                letterText={t.generating}
                subtitle={t.preparingOutput}
              />
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          animationType="slide"
          visible={gifTrimVisible}
          supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
          onRequestClose={closeGifTrimModal}
        >
          <View style={styles.sheetOverlay}>
            <ScrollView
              contentContainerStyle={[
                styles.gifModal,
                isLandscape && styles.gifModalLandscape,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }
              ]}
            >
              <View style={styles.gifModalHeader}>
                <View style={[styles.gifModalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Feather name="scissors" size={20} color={theme.colors.primary} />
                </View>
                <View style={styles.gifModalTitleWrap}>
                  <Text style={[styles.gifModalTitle, { color: theme.colors.text }]}>{t.gifTrim.title}</Text>
                  <Text style={[styles.gifModalBody, { color: theme.colors.muted }]}>{t.gifTrim.body}</Text>
                </View>
              </View>

              <VideoView
                player={gifPlayer}
                fullscreenOptions={{ enable: false }}
                allowsPictureInPicture={false}
                nativeControls
                style={[styles.gifPreview, { backgroundColor: theme.colors.surfaceAlt }]}
              />

              <View style={styles.gifPreviewActions}>
                <TouchableOpacity
                  style={[styles.gifMiniButton, { backgroundColor: theme.colors.primarySoft }]}
                  onPress={() => {
                    gifPlayer.currentTime = gifStartSeconds;
                    gifPlayer.play();
                  }}
                >
                  <Feather name="play" size={15} color={theme.colors.primary} />
                  <Text style={[styles.gifMiniButtonText, { color: theme.colors.primary }]}>{t.gifTrim.preview}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.gifMiniButton, { backgroundColor: theme.colors.surfaceAlt }]}
                  onPress={() => gifPlayer.pause()}
                >
                  <Feather name="pause" size={15} color={theme.colors.text} />
                  <Text style={[styles.gifMiniButtonText, { color: theme.colors.text }]}>{t.gifTrim.pause}</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.gifTimeline, { backgroundColor: theme.isDark ? "#050a12" : "#111827" }]}>
                <View style={styles.gifTimelineSegments}>
                  {Array.from({ length: 12 }).map((_, index) => (
                    <View
                      key={index}
                      style={[
                        styles.gifTimelineFrame,
                        {
                          borderColor: theme.isDark ? "#253650" : "#374151",
                          backgroundColor: index % 2 === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.14)"
                        }
                      ]}
                    >
                      {gifThumbnails[index] ? (
                        <Image
                          source={gifThumbnails[index].source}
                          style={styles.gifFrameImage}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={[styles.gifFrameMark, { backgroundColor: theme.colors.primary }]} />
                      )}
                    </View>
                  ))}
                </View>
                {isGeneratingGifThumbnails ? (
                  <View style={styles.gifTimelineLoading}>
                    <Feather name="image" size={14} color="#fff" />
                    <Text style={styles.gifTimelineLoadingText}>{t.gifTrim.loadingFrames}</Text>
                  </View>
                ) : null}
                <View
                  pointerEvents="none"
                  style={[
                    styles.gifTimelineSelection,
                    {
                      left: `${timelineLeftPercent(gifStartSeconds, gifVideoDuration)}%`,
                      width: `${timelineWidthPercent(gifDurationSeconds, gifVideoDuration)}%`,
                      borderColor: theme.colors.accent,
                      backgroundColor: theme.isDark ? "rgba(52, 211, 153, 0.22)" : "rgba(15, 188, 143, 0.22)"
                    }
                  ]}
                >
                  <View style={[styles.gifTrimHandle, { backgroundColor: theme.colors.accent }]} />
                  <View style={[styles.gifTrimHandle, { backgroundColor: theme.colors.accent }]} />
                </View>
                <View
                  pointerEvents="none"
                  style={[
                    styles.gifPlayhead,
                    {
                      left: `${timelineLeftPercent(gifCurrentSeconds, gifVideoDuration)}%`,
                      backgroundColor: theme.colors.primary
                    }
                  ]}
                />
              </View>

              <View style={styles.gifSliderGroup}>
                <View style={styles.gifSliderHeader}>
                  <Text style={[styles.gifInputLabel, { color: theme.colors.muted }]}>{t.gifTrim.start}</Text>
                  <Text style={[styles.gifValue, { color: theme.colors.text }]}>{formatSeconds(gifStartSeconds)}</Text>
                </View>
                <Slider
                  minimumValue={0}
                  maximumValue={Math.max(0, gifVideoDuration - gifDurationSeconds)}
                  step={0.1}
                  value={gifStartSeconds}
                  minimumTrackTintColor={theme.colors.primary}
                  maximumTrackTintColor={theme.colors.border}
                  thumbTintColor={theme.colors.primary}
                  onSlidingComplete={(value) => {
                    setGifStartSeconds(value);
                    gifPlayer.currentTime = value;
                  }}
                  onValueChange={setGifStartSeconds}
                />
              </View>

              <View style={styles.gifSliderGroup}>
                <View style={styles.gifSliderHeader}>
                  <Text style={[styles.gifInputLabel, { color: theme.colors.muted }]}>{t.gifTrim.duration}</Text>
                  <Text style={[styles.gifValue, { color: theme.colors.text }]}>{formatSeconds(gifDurationSeconds)}</Text>
                </View>
                <Slider
                  minimumValue={0.5}
                  maximumValue={3}
                  step={0.1}
                  value={gifDurationSeconds}
                  minimumTrackTintColor={theme.colors.accent}
                  maximumTrackTintColor={theme.colors.border}
                  thumbTintColor={theme.colors.accent}
                  onValueChange={(value) => {
                    const nextDuration = Math.min(3, Math.max(0.5, value));
                    setGifDurationSeconds(nextDuration);
                    setGifStartSeconds((current) => Math.min(current, Math.max(0, gifVideoDuration - nextDuration)));
                  }}
                />
              </View>

              <View style={[styles.gifHint, { backgroundColor: theme.colors.primarySoft }]}>
                <Text style={[styles.gifHintText, { color: theme.colors.text }]}>
                  {t.gifTrim.range}: {formatSeconds(gifStartSeconds)} - {formatSeconds(gifStartSeconds + gifDurationSeconds)}
                </Text>
                <Text style={[styles.gifHintText, { color: theme.colors.muted }]}>
                  {t.gifTrim.current}: {formatSeconds(gifCurrentSeconds)} / {formatSeconds(gifVideoDuration)}
                </Text>
              </View>

              <View style={styles.gifActions}>
                <TouchableOpacity
                  style={[styles.gifCancelButton, { borderColor: theme.colors.border }]}
                  onPress={closeGifTrimModal}
                >
                  <Text style={[styles.gifCancelText, { color: theme.colors.text }]}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.gifConfirmButton}
                  onPress={confirmGifTrim}
                >
                  <InstagramGradient theme={theme} style={styles.actionPrimaryGradient}>
                    <Text style={[styles.gifConfirmText, { color: theme.colors.onPrimary }]}>{t.gifTrim.confirm}</Text>
                  </InstagramGradient>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </Modal>
        {activeTab === "editor" ? (
          <DocumentEditorScreen
            file={editorFile}
            previewSource={editorPreviewSource}
            output={editorOutput}
            labels={t}
            theme={theme}
            pageCount={editorPageCount}
            pageNumber={editorPageNumber}
            sourcePageNumber={editorPagePlan[editorPageNumber - 1]?.sourcePage ?? null}
            isBlankPage={Boolean(editorPagePlan[editorPageNumber - 1]?.blank)}
            blankPageCount={editorPagePlan.filter((page) => page.blank).length}
            layers={editorLayers}
            selectedLayerId={selectedEditorLayerId}
            activeTool={activeEditorTool}
            strokeColor={editorStrokeColor}
            strokeWidth={editorStrokeWidth}
            savedDrawnSignatures={savedDrawnSignatures}
            canUndo={editorLayers.length > 0}
            canRedo={editorRedoLayers.length > 0}
            isBusy={isEditorBusy}
            isReading={isReadingDocument}
            speechRate={speechRate}
            speechLanguageLabel={currentLanguageOption.nativeName}
            message={editorMessage}
            onBack={closeDocumentEditor}
            onPickFile={() => void openDocumentEditor()}
            onPageNumberChange={setEditorPageNumber}
            onAddBlankPage={addBlankEditorPage}
            onDeletePage={deleteEditorPage}
            onToolChange={setActiveEditorTool}
            onStrokeColorChange={setEditorStrokeColor}
            onStrokeWidthChange={setEditorStrokeWidth}
            onAddText={() => addEditorLayer("text")}
            onAddDrawnSignature={(points) => addDrawnSignatureLayer(points, true)}
            onUseSavedDrawnSignature={(points) => addDrawnSignatureLayer(points, false)}
            onDeleteSavedDrawnSignature={deleteSavedDrawnSignature}
            onAddImageSignature={() => void addImageSignatureLayer()}
            onAddQrSignature={() => void addQrSignatureLayer()}
            onCommitStroke={commitEditorStroke}
            onSelectLayer={setSelectedEditorLayerId}
            onMoveLayer={moveEditorLayer}
            onResizeLayer={resizeEditorLayer}
            onRotateLayer={rotateEditorLayer}
            onLayerStyleChange={updateEditorLayerStyle}
            onDeleteLayer={deleteSelectedEditorLayer}
            onLayerTextChange={updateSelectedEditorLayerText}
            onUndo={undoEditorLayer}
            onRedo={redoEditorLayer}
            onReadAloud={() => void readEditorDocumentAloud()}
            onSpeechRateChange={setSpeechRate}
            onApply={() => void applyEditorChanges()}
            onShare={() => void shareEditedDocument()}
          />
        ) : (
        <ScrollView
          style={styles.mainScroll}
          contentContainerStyle={[
            styles.scrollContent,
            isLandscape && styles.scrollContentLandscape
          ]}
        >
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Image source={floatingBrandMark} style={styles.brandMarkImage} contentFit="contain" />
          </View>
          <View style={styles.headerTitleBlock}>
            <Text style={[styles.kicker, { color: theme.colors.muted }]}>{t.appKicker}</Text>
            <Text style={[styles.title, isLandscape && styles.titleLandscape, { color: theme.colors.text }]}>{t.title}</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              accessibilityLabel={t.toggleLanguage}
              style={[styles.iconButton, { backgroundColor: theme.colors.surface }]}
              onPress={() => setLanguageModalVisible(true)}
            >
              <Text style={styles.langFlag}>{currentLanguageOption.flag}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={t.toggleTheme}
              style={[styles.iconButton, { backgroundColor: theme.colors.surface }]}
              onPress={() => setThemeMode(theme.isDark ? "light" : "dark")}
            >
              {theme.isDark ? (
                <Feather name="sun" size={20} color={theme.colors.text} />
              ) : (
                <Feather name="moon" size={20} color={theme.colors.text} />
              )}
            </TouchableOpacity>
          </View>
        </View>
        <Animated.View style={[styles.screenPane, { transform: [{ translateX: screenSlide }] }]}>
        {activeTab === "convert" ? (
          <View style={styles.section}>
            <View style={[styles.quickActionPanel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={styles.quickActionHeader}>
                <View style={[styles.quickActionHeaderIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Feather name="zap" size={17} color={theme.colors.primary} />
                </View>
                <View style={styles.quickActionHeaderText}>
                  <Text style={[styles.quickActionTitle, { color: theme.colors.text }]}>{quickActionSectionCopy.title}</Text>
                  <Text style={[styles.quickActionSubtitle, { color: theme.colors.muted }]}>{quickActionSectionCopy.subtitle}</Text>
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickActionScroller}
              >
                {localizedQuickActionItems.map((item) => (
                  <TouchableOpacity
                    key={item.action}
                    activeOpacity={0.82}
                    disabled={item.action === "scanDocument" && isScanningDocument}
                    style={[
                      styles.quickActionCard,
                      { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
                      item.action === "scanDocument" && isScanningDocument && styles.disabledQuickActionCard
                    ]}
                    onPress={() => openQuickActionPicker(item.action)}
                  >
                    <View style={[styles.quickActionIcon, { backgroundColor: item.softColor }]}>
                      <Feather name={item.icon} size={22} color={item.color} />
                    </View>
                    <Text numberOfLines={2} style={[styles.quickActionCardText, { color: theme.colors.text }]}>
                      {item.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <ConversionForm
              files={files}
              inputType={inputType}
              theme={theme}
              labels={t}
              onSelectFiles={selectFiles}
              onRemoveFile={removeFile}
              onRenameFile={openRenameFile}
              onClearFiles={clearFiles}
            />
            <DocumentEditorCard labels={t} theme={theme} onOpen={() => void openDocumentEditor()} />
        </View>
        ) : activeTab === "archive" ? (
          <ArchiveManager
            labels={t}
            theme={theme}
            quickIntent={archiveQuickIntent}
            onQuickIntentConsumed={consumeArchiveQuickIntent}
          />
        ) : activeTab === "history" ? (
          <HistoryList
            history={history}
            theme={theme}
            labels={t}
            onRetry={runConversion}
            onShare={shareOutputs}
            onClear={clearHistory}
            onDelete={deleteHistoryJob}
          />
        ) : activeTab === "trash" ? (
          <View style={[styles.settingsCard, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.trashHeader}>
              <View style={styles.trashTitleRow}>
                <Feather name="trash-2" size={18} color={theme.colors.danger} />
                <Text style={[styles.settingsTitle, { color: theme.colors.text }]}>{t.trashTitle}</Text>
              </View>
              {trash.length > 0 ? (
                <TouchableOpacity
                  style={[styles.trashSmallButton, { backgroundColor: theme.colors.dangerSoft }]}
                  onPress={emptyTrash}
                >
                  <Text style={[styles.trashSmallText, { color: theme.colors.danger }]}>
                    {t.emptyTrash}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {trash.length === 0 ? (
              <Text style={[styles.errorText, { color: theme.colors.muted }]}>{t.trashEmpty}</Text>
            ) : (
              trash.map((job) => (
                <View
                  key={job.id}
                  style={[styles.trashRow, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt }]}
                >
                  <View style={styles.trashRowText}>
                    <Text style={[styles.trashName, { color: theme.colors.text }]}>
                      {job.inputType.toUpperCase()} {" -> "} {job.outputType.toUpperCase()}
                    </Text>
                    <Text style={[styles.errorText, { color: theme.colors.muted }]}>
                      {new Date(job.createdAt).toLocaleString()}
                    </Text>
                  </View>
                  {job.outputs?.length ? (
                    <TouchableOpacity
                      style={[styles.trashIconButton, { backgroundColor: theme.colors.primarySoft }]}
                      onPress={() => shareOutputs(job)}
                    >
                      <Feather name="download" size={16} color={theme.colors.primary} />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.trashIconButton, { backgroundColor: theme.colors.accentSoft }]}
                    onPress={() => restoreTrashJob(job)}
                  >
                    <Feather name="rotate-ccw" size={16} color={theme.colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.trashIconButton, { backgroundColor: theme.colors.dangerSoft }]}
                    onPress={() => deleteTrashJobForever(job.id)}
                  >
                    <Feather name="x" size={16} color={theme.colors.danger} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        ) : (
          <View style={[styles.settingsCard, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.settingsTitle, { color: theme.colors.text }]}>{t.settingsTab}</Text>
            <Text style={[styles.errorText, { color: theme.colors.muted }]}>{t.settingsSubtitle}</Text>

            <TouchableOpacity
              style={[styles.settingsRow, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}
              onPress={() => setLanguageModalVisible(true)}
            >
              <Text style={styles.languageFlag}>{currentLanguageOption.flag}</Text>
              <View style={styles.trashRowText}>
                <Text style={[styles.trashName, { color: theme.colors.text }]}>{t.currentLanguage}</Text>
                <Text style={[styles.errorText, { color: theme.colors.muted }]}>
                  {currentLanguageOption.nativeName} · {currentLanguageOption.englishName}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.colors.muted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingsRow, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}
              onPress={() => setThemeMode(theme.isDark ? "light" : "dark")}
            >
              <View style={[styles.settingsIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Feather name={theme.isDark ? "sun" : "moon"} size={18} color={theme.colors.primary} />
              </View>
              <View style={styles.trashRowText}>
                <Text style={[styles.trashName, { color: theme.colors.text }]}>{t.toggleTheme}</Text>
                <Text style={[styles.errorText, { color: theme.colors.muted }]}>
                  {theme.isDark ? t.themeDark : t.themeLight}
                </Text>
              </View>
            </TouchableOpacity>

            {showInternalDiagnostics ? (
              <TouchableOpacity
                style={[styles.settingsRow, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}
                onPress={openDiagnostics}
              >
                <View style={[styles.settingsIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Feather name="activity" size={18} color={theme.colors.primary} />
                </View>
                <View style={styles.trashRowText}>
                  <Text style={[styles.trashName, { color: theme.colors.text }]}>{t.diagnosticsTitle}</Text>
                  <Text style={[styles.settingsDocumentSummary, { color: theme.colors.muted }]}>
                    {diagnosticEntries.length} {t.diagnosticsCaptured}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={theme.colors.muted} />
              </TouchableOpacity>
            ) : null}

            {settingsDocumentOrder.map((key) => {
              const document = settingsDocuments[key];
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.settingsRow, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}
                  onPress={() => openSettingsDocument(key)}
                >
                  <View style={[styles.settingsIcon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Feather name={document.icon} size={18} color={theme.colors.primary} />
                  </View>
                  <View style={styles.trashRowText}>
                    <Text style={[styles.trashName, { color: theme.colors.text }]}>{document.title}</Text>
                    <Text style={[styles.settingsDocumentSummary, { color: theme.colors.muted }]}>
                      {document.summary}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={theme.colors.muted} />
                </TouchableOpacity>
              );
            })}

            <View style={[styles.infoBlock, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
              <Text style={[styles.trashName, { color: theme.colors.text }]}>{t.supportedFormatsTitle}</Text>
              <Text style={[styles.errorText, { color: theme.colors.muted }]}>{t.supportedFormatsBody}</Text>
            </View>

            <Text style={[styles.versionText, { color: theme.colors.muted }]}>
              Editio · {t.appVersionTitle}: {t.appVersion}
            </Text>
          </View>
        )}
        </Animated.View>
        </ScrollView>
        )}
        {activeTab !== "editor" ? (
          <SafeAreaInsetsContext.Consumer>
            {(insets) => {
              const bottomInset = Math.max(0, insets?.bottom ?? 0);
              const leftInset = Math.max(0, insets?.left ?? 0);
              const rightInset = Math.max(0, insets?.right ?? 0);
              const bottomPadding = Math.max(isLandscape ? 8 : 12, bottomInset + (isLandscape ? 6 : 8));
              const minHeight = (isLandscape ? 74 : 88) + bottomInset;

              return (
                <View
                  style={[
                    styles.bottomTabs,
                    isLandscape && styles.bottomTabsLandscape,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.border,
                      marginLeft: -leftInset,
                      marginRight: -rightInset,
                      minHeight,
                      paddingBottom: bottomPadding,
                      paddingLeft: leftInset + 8,
                      paddingRight: rightInset + 8
                    }
                  ]}
                >
                  <TabButton
                    active={activeTab === "convert"}
                    icon="upload"
                    label={t.convertTab}
                    theme={theme}
                    onPress={() => setActiveTab("convert")}
                  />
                  <TabButton
                    active={activeTab === "archive"}
                    icon="archive"
                    label={t.archiveTab}
                    theme={theme}
                    onPress={() => setActiveTab("archive")}
                  />
                  <TabButton
                    active={activeTab === "history"}
                    icon="clock"
                    label={t.historyTab}
                    theme={theme}
                    onPress={() => setActiveTab("history")}
                  />
                  <TabButton
                    active={activeTab === "trash"}
                    icon="trash-2"
                    label={t.trashTab}
                    theme={theme}
                    onPress={() => setActiveTab("trash")}
                  />
                  <TabButton
                    active={activeTab === "settings"}
                    icon="settings"
                    label={t.settingsTab}
                    theme={theme}
                    onPress={() => setActiveTab("settings")}
                  />
                </View>
              );
            }}
          </SafeAreaInsetsContext.Consumer>
        ) : null}
        {showSplash ? (
          <AppSplashScreen
            opacity={splashOpacity}
            progress={splashProgress}
            scale={splashScale}
            translateY={splashTranslateY}
            theme={theme}
            subtitle={t.appKicker}
          />
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1
  },
  mainScroll: {
    flex: 1
  },
  scrollContent: {
    gap: 18,
    padding: 20,
    paddingBottom: 28
  },
  scrollContentLandscape: {
    gap: 12,
    paddingHorizontal: 28,
    paddingVertical: 12
  },
  editorScrollContent: {
    flexGrow: 1
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  brandMark: {
    alignItems: "center",
    flexShrink: 0,
    height: 52,
    justifyContent: "center",
    width: 52
  },
  brandMarkImage: {
    height: 58,
    width: 58
  },
  kicker: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0,
    marginTop: 4
  },
  titleLandscape: {
    fontSize: 24,
    marginTop: 2
  },
  headerActions: {
    flexDirection: "row",
    flexShrink: 0,
    gap: 8,
    justifyContent: "flex-end",
    width: 96
  },
  headerTitleBlock: {
    flex: 1,
    minWidth: 0
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 16,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  langText: {
    fontSize: 13,
    fontWeight: "800"
  },
  langFlag: {
    fontSize: 22
  },
  bottomTabs: {
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 2,
    minHeight: 88,
    paddingBottom: 12,
    paddingHorizontal: 8,
    paddingTop: 8,
    shadowColor: "#DD2A7B",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    zIndex: 2
  },
  bottomTabsLandscape: {
    minHeight: 74,
    paddingBottom: 8,
    paddingTop: 8
  },
  tab: {
    alignItems: "center",
    borderRadius: 18,
    flex: 1,
    gap: 3,
    justifyContent: "center",
    maxWidth: "20%",
    minHeight: 58,
    minWidth: 0,
    overflow: "hidden",
    paddingHorizontal: 2,
    paddingVertical: 5,
    position: "relative"
  },
  tabText: {
    fontSize: 8.5,
    fontWeight: "900",
    maxWidth: "100%",
    minWidth: 0,
    textAlign: "center"
  },
  tabIndicator: {
    borderRadius: 999,
    bottom: 6,
    height: 3,
    position: "absolute",
    width: 18
  },
  section: {
    gap: 16
  },
  quickActionPanel: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 14
  },
  quickActionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  quickActionHeaderIcon: {
    alignItems: "center",
    borderRadius: 15,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  quickActionHeaderText: {
    flex: 1,
    minWidth: 0
  },
  quickActionTitle: {
    fontSize: 17,
    fontWeight: "900"
  },
  quickActionSubtitle: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 2
  },
  quickActionScroller: {
    gap: 10,
    paddingRight: 4
  },
  quickActionCard: {
    alignItems: "center",
    aspectRatio: 1,
    borderRadius: 18,
    borderWidth: 1,
    gap: 9,
    justifyContent: "center",
    padding: 10,
    width: 112
  },
  disabledQuickActionCard: {
    opacity: 0.58
  },
  quickActionIcon: {
    alignItems: "center",
    borderRadius: 18,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  quickActionCardText: {
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 15,
    textAlign: "center"
  },
  quickGalleryButton: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12
  },
  quickGalleryText: {
    fontSize: 14,
    fontWeight: "900"
  },
  screenPane: {
    gap: 16
  },
  errorBox: {
    borderRadius: 22,
    gap: 8,
    padding: 14
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "800"
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20
  },
  secondaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 12
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "800"
  },
  modalOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(18, 18, 18, 0.58)",
    flex: 1,
    justifyContent: "center",
    padding: 20
  },
  sheetOverlay: {
    backgroundColor: "rgba(18, 18, 18, 0.42)",
    flex: 1,
    justifyContent: "flex-end"
  },
  actionModal: {
    alignItems: "center",
    borderRadius: 28,
    gap: 14,
    maxWidth: 420,
    padding: 18,
    width: "100%"
  },
  editorLoaderWrap: {
    maxWidth: 340,
    width: "100%"
  },
  fullscreenLoaderOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(18, 18, 18, 0.74)",
    flex: 1,
    justifyContent: "center",
    padding: 22
  },
  fullscreenLoaderOverlayLandscape: {
    paddingHorizontal: 44,
    paddingVertical: 14
  },
  fullscreenLoaderWrap: {
    maxWidth: 360,
    width: "100%"
  },
  fullscreenLoaderWrapLandscape: {
    maxWidth: 330
  },
  actionModalIcon: {
    alignItems: "center",
    borderRadius: 20,
    height: 52,
    justifyContent: "center",
    width: 52
  },
  actionModalTitle: {
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center"
  },
  actionModalBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  },
  actionModalButtons: {
    flexDirection: "row",
    gap: 10,
    width: "100%"
  },
  actionCancelButton: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48
  },
  actionPrimaryButton: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    overflow: "hidden"
  },
  actionPrimaryGradient: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    width: "100%"
  },
  actionCancelText: {
    fontSize: 14,
    fontWeight: "900"
  },
  actionPrimaryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center"
  },
  languageModal: {
    borderRadius: 28,
    borderWidth: 1,
    gap: 14,
    maxWidth: 420,
    padding: 18,
    width: "100%"
  },
  languageModalLandscape: {
    borderRadius: 22,
    gap: 10,
    maxHeight: "84%",
    maxWidth: 610,
    padding: 12,
    width: "82%"
  },
  languageModalHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  languageListScrollLandscape: {
    maxHeight: 230
  },
  languageList: {
    gap: 9
  },
  languageListLandscape: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  languageRow: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 12
  },
  languageRowLandscape: {
    borderRadius: 14,
    flexBasis: "48.8%",
    flexGrow: 1,
    minHeight: 48,
    paddingHorizontal: 10
  },
  languageFlag: {
    fontSize: 25,
    width: 34
  },
  languageFlagLandscape: {
    fontSize: 22,
    width: 30
  },
  languageTextWrap: {
    flex: 1
  },
  languageName: {
    fontSize: 15,
    fontWeight: "900"
  },
  languageMeta: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2
  },
  languageTransitionOverlay: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 28
  },
  languageTransitionContent: {
    alignItems: "center",
    gap: 12,
    width: "100%"
  },
  languageTransitionLogo: {
    alignItems: "center",
    borderRadius: 34,
    height: 112,
    justifyContent: "center",
    shadowColor: "#DD2A7B",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.26,
    shadowRadius: 28,
    width: 112
  },
  languageTransitionLogoImage: {
    borderRadius: 28,
    height: 108,
    width: 108
  },
  languageTransitionTitle: {
    fontSize: 23,
    fontWeight: "900",
    marginTop: 8,
    textAlign: "center"
  },
  languageTransitionText: {
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center"
  },
  languageTransitionTrack: {
    borderRadius: 999,
    height: 8,
    marginTop: 10,
    maxWidth: 260,
    overflow: "hidden",
    width: "68%"
  },
  languageTransitionFill: {
    borderRadius: 999,
    height: "100%",
    overflow: "hidden"
  },
  languageTransitionFillGradient: {
    flex: 1,
    width: "100%"
  },
  convertModal: {
    borderRadius: 0,
    borderWidth: 1,
    flex: 1,
    gap: 14,
    paddingBottom: 24,
    paddingHorizontal: 18,
    paddingTop: 56,
    width: "100%"
  },
  convertModalLandscape: {
    gap: 8,
    paddingHorizontal: 28,
    paddingTop: 16
  },
  convertModalHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  convertModalTitleWrap: {
    flex: 1
  },
  convertModalTitle: {
    textAlign: "left"
  },
  convertModalClose: {
    alignItems: "center",
    borderRadius: 14,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  modalFileList: {
    gap: 8
  },
  modalFileRow: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 52,
    paddingHorizontal: 9
  },
  modalFileIcon: {
    alignItems: "center",
    borderRadius: 13,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  modalFileName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800"
  },
  modalPickerRow: {
    flexDirection: "row",
    gap: 10
  },
  modalPickerRowLandscape: {
    maxHeight: 112
  },
  modalPickerGroup: {
    flex: 1,
    gap: 6
  },
  modalDetectedBox: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50
  },
  modalDetectedBoxLandscape: {
    minHeight: 44
  },
  modalDetectedText: {
    fontSize: 14,
    fontWeight: "900"
  },
  modalPickerShell: {
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 50,
    overflow: "hidden"
  },
  modalPickerShellLandscape: {
    height: 86,
    justifyContent: "center",
    maxHeight: 86,
    minHeight: 86
  },
  modalPickerNativeLandscape: {
    height: 132,
    transform: [{ translateY: -22 }]
  },
  modalErrorBox: {
    borderRadius: 18,
    padding: 12
  },
  convertModalButtonClip: {
    borderRadius: 24,
    overflow: "hidden"
  },
  convertModalButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    minHeight: 62,
    paddingHorizontal: 16
  },
  convertModalButtonLandscape: {
    minHeight: 52
  },
  convertModalButtonIcon: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.38)",
    borderRadius: 999,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  convertModalButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900"
  },
  renameInput: {
    borderRadius: 18,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 12,
    width: "100%"
  },
  gifModal: {
    borderRadius: 0,
    borderWidth: 1,
    flexGrow: 1,
    gap: 16,
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 56,
    width: "100%"
  },
  gifModalLandscape: {
    gap: 10,
    paddingHorizontal: 28,
    paddingTop: 22
  },
  gifModalHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  gifModalIcon: {
    alignItems: "center",
    borderRadius: 18,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  gifModalTitleWrap: {
    flex: 1
  },
  gifModalTitle: {
    fontSize: 18,
    fontWeight: "900"
  },
  gifModalBody: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3
  },
  gifInputLabel: {
    fontSize: 12,
    fontWeight: "900"
  },
  gifPreview: {
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: "hidden",
    width: "100%"
  },
  gifPreviewActions: {
    flexDirection: "row",
    gap: 10
  },
  gifTimeline: {
    borderRadius: 12,
    height: 72,
    overflow: "hidden",
    position: "relative"
  },
  gifTimelineSegments: {
    flexDirection: "row",
    height: "100%",
    padding: 6
  },
  gifTimelineFrame: {
    alignItems: "center",
    borderRadius: 4,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    marginHorizontal: 1,
    overflow: "hidden"
  },
  gifFrameMark: {
    borderRadius: 999,
    height: 5,
    opacity: 0.9,
    width: 5
  },
  gifFrameImage: {
    height: "100%",
    width: "100%"
  },
  gifTimelineLoading: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.58)",
    bottom: 0,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  gifTimelineLoadingText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900"
  },
  gifTimelineSelection: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 2,
    bottom: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    minWidth: 30,
    paddingHorizontal: 2,
    position: "absolute",
    top: 4
  },
  gifTrimHandle: {
    borderRadius: 999,
    height: 34,
    width: 5
  },
  gifPlayhead: {
    bottom: 6,
    position: "absolute",
    top: 6,
    width: 2
  },
  gifMiniButton: {
    alignItems: "center",
    borderRadius: 10,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 42
  },
  gifMiniButtonText: {
    fontSize: 13,
    fontWeight: "900"
  },
  gifSliderGroup: {
    gap: 4
  },
  gifSliderHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  gifValue: {
    fontSize: 13,
    fontWeight: "900"
  },
  gifHint: {
    borderRadius: 12,
    padding: 12
  },
  gifHintText: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18
  },
  gifActions: {
    flexDirection: "row",
    gap: 10
  },
  gifCancelButton: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48
  },
  gifConfirmButton: {
    alignItems: "center",
    borderRadius: 10,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    overflow: "hidden"
  },
  gifCancelText: {
    fontSize: 14,
    fontWeight: "900"
  },
  gifConfirmText: {
    fontSize: 14,
    fontWeight: "900"
  },
  settingsCard: {
    borderRadius: 24,
    gap: 12,
    padding: 18
  },
  settingsTitle: {
    fontSize: 20,
    fontWeight: "900"
  },
  trashHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12
  },
  trashTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  trashSmallButton: {
    borderRadius: 16,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 10
  },
  trashSmallText: {
    fontSize: 12,
    fontWeight: "900"
  },
  trashRow: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 60,
    padding: 10
  },
  trashRowText: {
    flex: 1
  },
  trashName: {
    fontSize: 14,
    fontWeight: "900"
  },
  trashIconButton: {
    alignItems: "center",
    borderRadius: 14,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  settingsRow: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    padding: 12
  },
  settingsIcon: {
    alignItems: "center",
    borderRadius: 16,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  settingsDocumentSummary: {
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 2
  },
  infoBlock: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    padding: 14
  },
  legalModal: {
    borderRadius: 28,
    borderWidth: 1,
    maxHeight: "82%",
    padding: 18,
    width: "88%"
  },
  legalModalLandscape: {
    maxHeight: "86%",
    maxWidth: 660,
    width: "64%"
  },
  legalHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  legalIcon: {
    alignItems: "center",
    borderRadius: 16,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  legalTitleColumn: {
    flex: 1
  },
  legalTitle: {
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 22
  },
  legalSubtitle: {
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 2
  },
  legalCloseButton: {
    alignItems: "center",
    borderRadius: 15,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  legalScroll: {
    marginTop: 16
  },
  legalScrollContent: {
    gap: 16,
    paddingBottom: 6
  },
  legalSection: {
    gap: 7
  },
  legalSectionTitle: {
    fontSize: 14,
    fontWeight: "900"
  },
  legalParagraph: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  diagnosticsIntro: {
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 12
  },
  diagnosticsEmpty: {
    alignItems: "center",
    borderRadius: 20,
    gap: 8,
    justifyContent: "center",
    minHeight: 140,
    padding: 18
  },
  diagnosticsEmptyText: {
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center"
  },
  diagnosticsEntry: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 7,
    padding: 12
  },
  diagnosticsMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  diagnosticsLevel: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0
  },
  diagnosticsDate: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right"
  },
  diagnosticsSource: {
    fontSize: 11,
    fontWeight: "900"
  },
  diagnosticsMessage: {
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17
  },
  diagnosticsStack: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: undefined }),
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 15
  },
  diagnosticsActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    width: "100%"
  },
  versionText: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center"
  }
});

function TabButton({
  active,
  icon,
  label,
  theme,
  onPress
}: {
  active: boolean;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  theme: ReturnType<typeof getTheme>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tab, active && { backgroundColor: theme.colors.primarySoft }]}
      onPress={onPress}
    >
      <Feather name={icon} size={18} color={active ? theme.colors.primary : theme.colors.muted} />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        style={[styles.tabText, { color: active ? theme.colors.primary : theme.colors.muted }]}
      >
        {label}
      </Text>
      {active ? <InstagramGradient theme={theme} style={styles.tabIndicator} /> : null}
    </TouchableOpacity>
  );
}

function isGifSource(type: FileType | null) {
  return type === "mp4" || type === "mov";
}

function buildSafeDisplayName(nextName: string, originalName: string) {
  const cleanName = nextName.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!cleanName) return "";

  const originalExtension = originalName.includes(".") ? originalName.split(".").pop() : "";
  const nextExtension = cleanName.includes(".") ? cleanName.split(".").pop() : "";
  if (originalExtension && !nextExtension) {
    return `${cleanName}.${originalExtension}`;
  }
  return cleanName;
}

function shouldLimitToSingleFile(type: FileType | null) {
  return (
    type === "mp4" ||
    type === "mov" ||
    type === "avi" ||
    type === "mkv" ||
    type === "webm" ||
    type === "gif" ||
    type === "mp3" ||
    type === "wav" ||
    type === "ogg" ||
    type === "flac" ||
    type === "m4a"
  );
}

function formatSeconds(seconds: number) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const tenths = Math.floor((safeSeconds % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${tenths}`;
}

function waitForMinimumElapsed(startedAt: number, minimumMs: number) {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remaining));
}

function timelineLeftPercent(seconds: number, duration: number) {
  if (!duration || duration <= 0) return 0;
  return Math.max(0, Math.min(100, (seconds / duration) * 100));
}

function timelineWidthPercent(seconds: number, duration: number) {
  if (!duration || duration <= 0) return 100;
  return Math.max(8, Math.min(100, (seconds / duration) * 100));
}

function detectFileTypeFromFile(file?: AppFile): FileType | null {
  return fileTypeFromDetection(detectFileTypeInfo(file));
}

function localizeConversionError(caught: unknown, labels: typeof translations.en) {
  const message = caught instanceof Error ? caught.message : "";
  if (message.includes("ERR_FILE_TOO_LARGE")) return labels.errors.fileTooLarge;
  if (message.includes("ERR_SPREADSHEET_TOO_LARGE")) return labels.errors.spreadsheetTooLarge;
  if (message.includes("ERR_TYPE_MISMATCH")) return labels.errors.typeMismatch;
  if (message.includes("ERR_UNSUPPORTED_CONVERSION")) return labels.errors.unsupported;
  if (message.includes("ERR_NATIVE_BUILD_REQUIRED")) return labels.errors.nativeRequired;
  if (message.includes("ERR_FILE_READ_FAILED")) return labels.errors.fileReadFailed;
  if (message.includes("ERR_CONVERSION_FAILED")) return labels.errors.conversionFailed;
  if (message.includes("ERR_BACKEND_URL_MISSING")) return labels.errors.backendUnavailable;
  if (message.includes("ERR_BACKEND_UNAVAILABLE")) return labels.errors.backendUnavailable;
  if (message.includes("Network Error") || message.includes("status code 404")) return labels.errors.backendUnavailable;
  if (message.includes("status code 500")) return labels.errors.conversionFailed;
  return message || labels.errors.unknown;
}

function extensionFromGalleryAsset(asset: ImagePicker.ImagePickerAsset) {
  const filenameExtension = asset.fileName?.split(".").pop()?.toLowerCase();
  if (filenameExtension) return filenameExtension === "jpeg" ? "jpg" : filenameExtension;

  const uriExtension = asset.uri.split("?")[0]?.split(".").pop()?.toLowerCase();
  if (uriExtension && uriExtension.length <= 5) return uriExtension === "jpeg" ? "jpg" : uriExtension;

  if (asset.mimeType?.includes("png")) return "png";
  if (asset.mimeType?.includes("webp")) return "webp";
  if (asset.mimeType?.includes("gif")) return "gif";
  if (asset.mimeType?.includes("quicktime")) return "mov";
  if (asset.type === "video") return "mp4";
  return "jpg";
}

function mimeFromGalleryAsset(asset: ImagePicker.ImagePickerAsset, extension: string) {
  if (asset.mimeType) return asset.mimeType;
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "mov") return "video/quicktime";
  if (extension === "mp4") return "video/mp4";
  return asset.type === "video" ? "video/mp4" : "image/jpeg";
}

function fitSignaturePoints(points: Array<{ x: number; y: number; move?: boolean }>) {
  const drawablePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (drawablePoints.length < 2) {
    return { points, width: 0.26, height: 0.1 };
  }

  const minX = Math.min(...drawablePoints.map((point) => point.x));
  const maxX = Math.max(...drawablePoints.map((point) => point.x));
  const minY = Math.min(...drawablePoints.map((point) => point.y));
  const maxY = Math.max(...drawablePoints.map((point) => point.y));
  const sourceWidth = Math.max(0.04, maxX - minX);
  const sourceHeight = Math.max(0.04, maxY - minY);
  const targetWidth = 0.28;
  const targetHeight = 0.11;
  const targetAspect = 2.55;
  const sourceAspect = sourceWidth / sourceHeight;
  const scaleX = sourceAspect > targetAspect ? 1 : sourceAspect / targetAspect;
  const scaleY = sourceAspect > targetAspect ? targetAspect / sourceAspect : 1;
  const offsetX = (1 - scaleX) / 2;
  const offsetY = (1 - scaleY) / 2;
  const padding = 0.1;
  const fittedPoints = points.map((point) => ({
    x: padding + (offsetX + ((point.x - minX) / sourceWidth) * scaleX) * (1 - padding * 2),
    y: padding + (offsetY + ((point.y - minY) / sourceHeight) * scaleY) * (1 - padding * 2),
    move: point.move
  }));

  return { points: fittedPoints, width: targetWidth, height: targetHeight };
}

function createSourcePagePlan(pageCount: number): DocumentPagePlanItem[] {
  return Array.from({ length: Math.max(1, pageCount) }, (_, index) => ({
    id: `source_${index + 1}`,
    sourcePage: index + 1
  }));
}

function pointsToLayerBox(points: Array<{ x: number; y: number; move?: boolean }>) {
  const safePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (safePoints.length < 2) return null;
  const minX = Math.min(...safePoints.map((point) => point.x));
  const maxX = Math.max(...safePoints.map((point) => point.x));
  const minY = Math.min(...safePoints.map((point) => point.y));
  const maxY = Math.max(...safePoints.map((point) => point.y));
  return {
    x: Math.max(0.01, minX),
    y: Math.max(0.01, minY),
    width: Math.max(0.06, Math.min(0.98 - minX, maxX - minX)),
    height: Math.max(0.03, Math.min(0.98 - minY, maxY - minY))
  };
}

function speechLocaleForLanguage(appLanguage: Language) {
  if (appLanguage === "tr") return "tr-TR";
  if (appLanguage === "fr") return "fr-FR";
  if (appLanguage === "de") return "de-DE";
  if (appLanguage === "es") return "es-ES";
  if (appLanguage === "ru") return "ru-RU";
  if (appLanguage === "zh") return "zh-CN";
  return "en-US";
}

function pickSpeechVoiceIdentifier(voices: Speech.Voice[], locale: string) {
  const normalizedLocale = locale.toLowerCase();
  const languageCode = normalizedLocale.split("-")[0];
  const candidates = voices.filter((voice) => voice.language.toLowerCase() === normalizedLocale);
  const looseCandidates = voices.filter((voice) => voice.language.toLowerCase().startsWith(`${languageCode}-`));
  const ordered = candidates.length > 0 ? candidates : looseCandidates;
  const enhanced = ordered.find((voice) => voice.quality === Speech.VoiceQuality.Enhanced);
  return (enhanced ?? ordered[0])?.identifier ?? null;
}

function quickActionDocumentTypes(action: HomeQuickAction) {
  if (action === "convertUdf") return "*/*";
  if (action === "zipCreate") return "*/*";
  if (action === "zipOpen") return archivePickerMimeTypes;
  if (action === "toMp3") return ["video/*", "audio/*"];
  if (action === "toMp4") return ["image/gif", "video/*"];
  if (action === "compressPdf") return ["application/pdf"];
  if (action === "exportPdf") return ["application/pdf"];
  if (action === "readAloud") return ["application/pdf", "text/plain"];
  if (action === "createPdf") return ["image/jpeg", "image/png", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
  return ["application/pdf", "image/jpeg", "image/png", "text/plain"];
}

function quickActionGalleryMediaTypes(action: HomeQuickAction): Array<"images" | "videos"> {
  if (action === "toMp3") return ["videos"];
  if (action === "toMp4") return ["videos"];
  return ["images"];
}

function normalizeScannedImageUri(uri: string) {
  if (uri.startsWith("file://") || uri.startsWith("content://") || uri.startsWith("ph://")) return uri;
  if (uri.startsWith("/")) return `file://${uri}`;
  return uri;
}

function waitForModalDismiss() {
  return new Promise((resolve) => setTimeout(resolve, 240));
}

function eraseStrokeLayer(
  layer: DocumentEditLayer,
  eraserPoints: Array<{ x: number; y: number; move?: boolean }>,
  eraserRadius: number
) {
  const points = layer.points ?? [];
  const eraser = eraserPoints.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length < 2 || eraser.length < 1) return [layer];

  const strokeRadius = Math.max(0.004, (layer.lineWidth ?? 3) / 1200);
  const radiusSquared = (eraserRadius + strokeRadius) * (eraserRadius + strokeRadius);
  const segments: Array<Array<{ x: number; y: number; move?: boolean }>> = [];
  let currentSegment: Array<{ x: number; y: number; move?: boolean }> = [];
  let changed = false;

  for (const point of points) {
    const shouldErase = eraser.some((eraserPoint) => {
      const dx = point.x - eraserPoint.x;
      const dy = point.y - eraserPoint.y;
      return dx * dx + dy * dy <= radiusSquared;
    });

    if (shouldErase) {
      changed = true;
      if (currentSegment.length > 1) segments.push(currentSegment);
      currentSegment = [];
      continue;
    }

    currentSegment.push({
      ...point,
      move: currentSegment.length === 0 ? true : point.move
    });
  }

  if (currentSegment.length > 1) segments.push(currentSegment);
  if (!changed) return [layer];

  return segments.map((segment, index) => ({
    ...layer,
    id: `${layer.id}_erased_${Date.now()}_${index}`,
    points: segment
  }));
}

async function prepareShareUri(output: ConvertedFile) {
  if (!output.uri.startsWith("http://") && !output.uri.startsWith("https://")) {
    return output.uri;
  }

  const shareDirectory = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ""}shared/`;
  const info = await FileSystem.getInfoAsync(shareDirectory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(shareDirectory, { intermediates: true });
  }

  const safeName = output.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const localUri = `${shareDirectory}${safeName}`;
  const existing = await FileSystem.getInfoAsync(localUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
  }
  await FileSystem.downloadAsync(output.uri, localUri);
  return localUri;
}

async function createNativeOutputZip(outputs: ConvertedFile[]): Promise<ConvertedFile> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const output of outputs) {
    const localUri = await prepareShareUri(output);
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64
    });
    zip.file(output.name, base64, { base64: true });
  }

  const zipBase64 = await zip.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    type: "base64"
  });
  const shareDirectory = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ""}shared/`;
  const info = await FileSystem.getInfoAsync(shareDirectory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(shareDirectory, { intermediates: true });
  }
  const zipUri = `${shareDirectory}${createShareZipName(outputs)}`;
  await FileSystem.writeAsStringAsync(zipUri, zipBase64, {
    encoding: FileSystem.EncodingType.Base64
  });
  return {
    name: zipUri.split("/").pop() ?? "converted_files.zip",
    uri: zipUri,
    mimeType: "application/zip"
  };
}

async function createWebOutputZip(outputs: ConvertedFile[]): Promise<ConvertedFile> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const output of outputs) {
    const response = await fetch(output.uri);
    if (!response.ok) throw new Error("ERR_FILE_READ_FAILED");
    zip.file(output.name, await response.blob());
  }

  const blob = await zip.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    type: "blob"
  });
  return {
    name: createShareZipName(outputs),
    uri: URL.createObjectURL(blob),
    mimeType: "application/zip"
  };
}

function createShareZipName(outputs: ConvertedFile[]) {
  const firstName = outputs[0]?.name ?? "converted_files";
  const baseName = firstName
    .replace(/\.[^.]+$/, "")
    .replace(/_page_\d+.*$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+$/, "");
  return `${baseName || "converted_files"}_outputs_${Date.now()}.zip`;
}

function shouldShareOutputsAsZip(job: ConversionJob) {
  return job.outputs !== undefined && job.outputs.length > 1 && !isImageOutputType(job.outputType);
}

function shareModalBodyText(job: ConversionJob | null, labels: typeof translations.en) {
  if (!job) return labels.shareModalBody;
  const parts = [labels.shareModalBody];

  if (job.outputs && job.outputs.length > 1) {
    parts.push(shouldShareOutputsAsZip(job) ? labels.multiOutputZipNotice : labels.multiOutputImageNotice);
  }

  if (job.summary) {
    parts.push(job.summary);
  }

  return parts.join("\n\n");
}

function compressionSummaryText(
  result: { originalBytes: number; compressedBytes: number; savedBytes: number; savedPercent: number },
  language: Language
) {
  const original = formatByteSize(result.originalBytes);
  const compressed = formatByteSize(result.compressedBytes);
  const saved = `${formatByteSize(result.savedBytes)} (${result.savedPercent.toFixed(1)}%)`;

  if (language === "tr") {
    return `PDF sıkıştırıldı.\nÖnce: ${original}\nSonra: ${compressed}\nKazanç: ${saved}`;
  }

  return `PDF compressed.\nBefore: ${original}\nAfter: ${compressed}\nSaved: ${saved}`;
}

function formatByteSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function isImageOutputType(type: FileType) {
  return type === "jpg" || type === "png" || type === "webp" || type === "gif";
}
