import { Tabs } from 'expo-router';

import { TabButton } from '@/components/TabButton';
import { TabIcon } from '@/components/TabIcon';
import { fontFamilies, stroke, typography } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

// Bottom tabs, so the main screens are one tap away (owner feedback,
// docs/ui-backlog.md). Tabs appear only once their feature exists: Run arrives
// with run logging, Duels in milestone 6, Pro in milestone 7.
export default function TabLayout() {
  const c = useColours();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.background },
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.divider, borderTopWidth: stroke.thin },
        tabBarLabelStyle: {
          fontFamily: fontFamilies.displaySemiBold,
          fontSize: typography.caption.fontSize,
          letterSpacing: typography.label.letterSpacing,
          textTransform: 'uppercase',
        },
        tabBarButton: (props) => <TabButton {...props} />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size, focused }) => <TabIcon ios={focused ? 'house.fill' : 'house'} android="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="standings"
        options={{
          title: 'League',
          tabBarIcon: ({ color, size, focused }) => <TabIcon ios={focused ? 'trophy.fill' : 'trophy'} android="leaderboard" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: 'You',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon ios={focused ? 'person.crop.circle.fill' : 'person.crop.circle'} android="person" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
