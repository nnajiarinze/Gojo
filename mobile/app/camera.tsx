import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  SafeAreaView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useReceiptStore } from '../src/store/receiptStore';
import { ErrorState } from '../src/components/ErrorState';

export default function CameraScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const setImageUri = useReceiptStore((s) => s.setImageUri);

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
  if (photoUri) {
    return (
      <SafeAreaView style={styles.container}>
        <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="contain" />
        <View style={styles.previewActions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.retakeBtn]}
            onPress={() => setPhotoUri(null)}
          >
            <Text style={styles.retakeText}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.continueBtn]}
            onPress={() => {
              setImageUri(photoUri);
              // Push: keep camera in the back stack so user can press back
              // from Result to retake the photo. Processing is transient and
              // will replace itself with Result, giving stack:
              // [Home, Camera, Result]
              router.push('/processing');
            }}
          >
            <Text style={styles.continueText}>Continue</Text>
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
              style={styles.captureBtn}
              onPress={async () => {
                try {
                  const photo = await cameraRef.current?.takePictureAsync({
                    quality: 0.8,
                  });
                  if (photo?.uri) setPhotoUri(photo.uri);
                } catch (e: any) {
                  // Camera unmounted during capture — safe to ignore
                  console.log('[Camera] Capture dismissed:', e.message);
                }
              }}
            >
              <View style={styles.captureBtnInner} />
            </TouchableOpacity>
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
  captureRow: { alignItems: 'center', paddingBottom: 20 },
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
