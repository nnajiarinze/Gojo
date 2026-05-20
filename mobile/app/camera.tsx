import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useReceiptStore } from '../src/store/receiptStore';
import { ErrorState } from '../src/components/ErrorState';
import { getReceiptImage, loadLatestPhotoThumbnail, ReceiptImagePermissionError, ReceiptImageValidationError } from '../src/services/receiptImage';

export default function CameraScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<{ uri: string; width?: number; height?: number } | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [choosingGallery, setChoosingGallery] = useState(false);
  const [latestThumbnailUri, setLatestThumbnailUri] = useState<string | null>(null);
  const setReceiptImage = useReceiptStore((s) => s.setReceiptImage);

  useEffect(() => {
    let mounted = true;
    loadLatestPhotoThumbnail().then((uri) => {
      if (mounted) setLatestThumbnailUri(uri);
    });
    return () => { mounted = false; };
  }, []);

  const chooseFromGallery = async () => {
    setChoosingGallery(true);
    try {
      const image = await getReceiptImage({ source: 'gallery' });
      if (!image) return;
      setLatestThumbnailUri(image.uri);
      setReceiptImage(image);
      router.push('/processing');
    } catch (err: any) {
      const title = err instanceof ReceiptImagePermissionError
        ? 'Photo Access Needed'
        : err instanceof ReceiptImageValidationError
          ? 'Unsupported Image'
          : 'Could Not Choose Image';
      Alert.alert(title, err?.message ?? 'Please try another image.');
    } finally {
      setChoosingGallery(false);
    }
  };

  // Permission not yet determined
  if (!permission) {
    return <View style={styles.container} />;
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <ErrorState
          message="Camera permission is required to scan receipts."
          onRetry={requestPermission}
        />
      </SafeAreaView>
    );
  }

  // Photo preview mode
  if (photo) {
    return (
      <SafeAreaView style={styles.container}>
        <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" />
        <View style={styles.previewActions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.retakeBtn]}
            onPress={() => setPhoto(null)}
            disabled={continuing}
          >
            <Text style={styles.retakeText}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.continueBtn]}
            disabled={continuing}
            onPress={async () => {
              setContinuing(true);
              try {
                const image = await getReceiptImage({
                  source: 'camera',
                  uri: photo.uri,
                  width: photo.width,
                  height: photo.height,
                });
                if (!image) return;
                setReceiptImage(image);
              } catch (err: any) {
                Alert.alert('Could Not Use Photo', err?.message ?? 'Please retake the photo.');
                return;
              } finally {
                setContinuing(false);
              }
              // Push: keep camera in the back stack so user can press back
              // from Result to retake the photo. Processing is transient and
              // will replace itself with Result, giving stack:
              // [Home, Camera, Result]
              router.push('/processing');
            }}
          >
            <Text style={styles.continueText}>{continuing ? 'Preparing…' : 'Continue'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Camera viewfinder
  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        <SafeAreaView style={styles.cameraOverlay}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>✕</Text>
          </TouchableOpacity>

          <View style={styles.captureRow}>
            <TouchableOpacity
              style={[styles.galleryAffordance, choosingGallery && styles.disabled]}
              onPress={chooseFromGallery}
              disabled={choosingGallery}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Choose receipt image from gallery"
            >
              {choosingGallery ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : latestThumbnailUri ? (
                <Image source={{ uri: latestThumbnailUri }} style={styles.galleryThumbnail} resizeMode="cover" />
              ) : (
                <Text style={styles.galleryIcon}>▧</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.captureBtn}
              onPress={async () => {
                try {
                  const photo = await cameraRef.current?.takePictureAsync({
                    quality: 0.8,
                  });
                  if (photo?.uri) setPhoto({ uri: photo.uri, width: photo.width, height: photo.height });
                } catch (e: any) {
                  // Camera unmounted during capture — safe to ignore
                  console.log('[Camera] Capture dismissed:', e.message);
                }
              }}
            >
              <View style={styles.captureBtnInner} />
            </TouchableOpacity>
            <View style={styles.captureSideSpacer} />
          </View>
        </SafeAreaView>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  galleryAffordance: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryIcon: { color: '#fff', fontSize: 28, fontWeight: '700' },
  galleryThumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 13,
  },
  captureSideSpacer: { width: 52, height: 52 },
  disabled: { opacity: 0.65 },
  captureBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtnInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
  },
  preview: { flex: 1, backgroundColor: '#000' },
  previewActions: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    backgroundColor: '#000',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  retakeBtn: { backgroundColor: '#374151' },
  retakeText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  continueBtn: { backgroundColor: '#fff' },
  continueText: { color: '#111827', fontSize: 16, fontWeight: '700' },
});
