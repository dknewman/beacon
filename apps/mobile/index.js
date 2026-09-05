/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import { createRootComponent } from './src/app/bootstrap';

AppRegistry.registerComponent(appName, createRootComponent);
