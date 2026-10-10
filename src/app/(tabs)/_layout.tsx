import { Tabs } from 'expo-router';

import { TabButton } from '@/components/TabButton';
import { TabIcon } from '@/components/TabIcon';
import { fontFamilies, stroke, typography } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

// Five bottom tabs, so the main screens are one tap away (owner decision,
// docs/ui-backlog.md): Home, League, Run (centre), Activity, You. Duels live
// on Home and in the League table (milestone 6); Pro analytics join the
// Activity tab (milestone 7).
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
        name="run"
        options={{
          title: 'Run',
          tabBarIcon: ({ color, size }) => <TabIcon ios="figure.run" android="directions_run" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon ios={focused ? 'chart.bar.fill' : 'chart.bar'} android="bar_chart" color={color} size={size} />
          ),
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
