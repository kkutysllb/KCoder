---
id: vercel-react-native-skills
name: React Native & Expo
---
# React Native & Expo Best Practices

Performant mobile apps with React Native.

## Lists

- `FlashList` (Shopify) for long lists; stable `getItemType`; fixed item sizes where possible.
- Never render the full array — window/paginate.

## Animations

- Reanimated 3 worklets run on the UI thread — keep JS thread out of the frame loop.
- `useSharedValue` + `useAnimatedStyle`; avoid state-driven animation re-renders.
- Gesture Handler for interactions; compose gestures explicitly.

## Architecture

- New Architecture (Fabric/TurboModules) — use `expo-modules` for native bridges.
- Keep navigation state minimal; screens lazy via `React.lazy` where supported.

## Platform Care

- `Platform.select` / platform extensions for divergence; test iOS + Android.
- Safe areas, keyboard avoidance, and dynamic type from day one.

## Performance Loop

- Profile with Flipper/React DevTools + Xcode/Android Studio; fix measured issues only.
