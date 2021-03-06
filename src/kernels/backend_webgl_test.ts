/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as tf from '../index';
import {describeWithFlags} from '../jasmine_util';
import {expectArraysClose, expectArraysEqual, WEBGL_ENVS} from '../test_util';
import {MathBackendWebGL, SIZE_UPLOAD_UNIFORM, WebGLMemoryInfo} from './backend_webgl';

describeWithFlags('lazy packing and unpacking', WEBGL_ENVS, () => {
  it('should not leak memory when lazily unpacking', () => {
    const a = tf.tensor2d([1, 2, 3, 4, 5, 6], [2, 3]);
    const b = tf.tensor2d([0, 1, -3, 2, 2, 1], [3, 2]);

    const c = tf.matMul(a, b);

    const startNumBytes = tf.memory().numBytes;
    const startNumTensors = tf.memory().numTensors;

    tf.add(c, 1);

    expect(tf.memory().numBytes - startNumBytes).toEqual(16);
    expect(tf.memory().numTensors - startNumTensors).toEqual(1);
  });

  it('should not leak memory when lazily packing', () => {
    const a = tf.tensor2d([1, 2, 3, 4, 5, 6], [2, 3]);
    const b = tf.tensor2d([0, 1, -3, 2, 2, 1], [3, 2]);

    const c = tf.add(a, 1);

    const startNumBytes = tf.memory().numBytes;
    const startNumTensors = tf.memory().numTensors;

    tf.matMul(b, c);

    expect(tf.memory().numBytes - startNumBytes).toEqual(36);
    expect(tf.memory().numTensors - startNumTensors).toEqual(1);
  });
});

describeWithFlags('backendWebGL', WEBGL_ENVS, () => {
  let prevBackend: string;

  beforeAll(() => {
    prevBackend = tf.getBackend();
  });

  afterEach(() => {
    tf.setBackend(prevBackend);
    tf.ENV.removeBackend('test-storage');
  });

  it('delayed storage, reading', () => {
    const delayedStorage = true;
    const backend = new MathBackendWebGL(null, delayedStorage);
    tf.ENV.registerBackend('test-storage', () => backend);
    tf.setBackend('test-storage');

    const texManager = backend.getTextureManager();
    const t = tf.Tensor.make([3], {}, 'float32');
    backend.write(t.dataId, new Float32Array([1, 2, 3]));
    expect(texManager.getNumUsedTextures()).toBe(0);
    backend.getTexture(t.dataId);
    expect(texManager.getNumUsedTextures()).toBe(1);
    expectArraysClose(backend.readSync(t.dataId), new Float32Array([1, 2, 3]));
    expect(texManager.getNumUsedTextures()).toBe(0);
    backend.getTexture(t.dataId);
    expect(texManager.getNumUsedTextures()).toBe(1);
    backend.disposeData(t.dataId);
    expect(texManager.getNumUsedTextures()).toBe(0);
  });

  it('delayed storage, overwriting', () => {
    const delayedStorage = true;
    const backend = new MathBackendWebGL(null, delayedStorage);
    tf.ENV.registerBackend('test-storage', () => backend);
    tf.setBackend('test-storage');

    const texManager = backend.getTextureManager();
    const t = tf.Tensor.make([3], {}, 'float32');
    backend.write(t.dataId, new Float32Array([1, 2, 3]));
    backend.getTexture(t.dataId);
    expect(texManager.getNumUsedTextures()).toBe(1);
    // overwrite.
    backend.write(t.dataId, new Float32Array([4, 5, 6]));
    expect(texManager.getNumUsedTextures()).toBe(0);
    expectArraysClose(backend.readSync(t.dataId), new Float32Array([4, 5, 6]));
    backend.getTexture(t.dataId);
    expect(texManager.getNumUsedTextures()).toBe(1);
    expectArraysClose(backend.readSync(t.dataId), new Float32Array([4, 5, 6]));
    expect(texManager.getNumUsedTextures()).toBe(0);
  });

  it('immediate storage reading', () => {
    const delayedStorage = false;
    const backend = new MathBackendWebGL(null, delayedStorage);
    tf.ENV.registerBackend('test-storage', () => backend);
    tf.setBackend('test-storage');

    const texManager = backend.getTextureManager();
    const t = tf.Tensor.make([3], {}, 'float32');
    backend.write(t.dataId, new Float32Array([1, 2, 3]));
    expect(texManager.getNumUsedTextures()).toBe(1);
    expectArraysClose(backend.readSync(t.dataId), new Float32Array([1, 2, 3]));
    expect(texManager.getNumUsedTextures()).toBe(1);
    backend.disposeData(t.dataId);
    expect(texManager.getNumUsedTextures()).toBe(0);
  });

  it('immediate storage overwriting', () => {
    const delayedStorage = false;
    const backend = new MathBackendWebGL(null, delayedStorage);
    tf.ENV.registerBackend('test-storage', () => backend);
    tf.setBackend('test-storage');

    const texManager = backend.getTextureManager();
    const t = tf.Tensor.make([3], {}, 'float32');
    backend.write(t.dataId, new Float32Array([1, 2, 3]));
    expect(texManager.getNumUsedTextures()).toBe(1);
    backend.write(t.dataId, new Float32Array([4, 5, 6]));
    expect(texManager.getNumUsedTextures()).toBe(1);
    expectArraysClose(backend.readSync(t.dataId), new Float32Array([4, 5, 6]));
    expect(texManager.getNumUsedTextures()).toBe(1);
    backend.disposeData(t.dataId);
    expect(texManager.getNumUsedTextures()).toBe(0);
  });

  it('disposal of backend disposes all textures', () => {
    const delayedStorage = false;
    const backend = new MathBackendWebGL(null, delayedStorage);
    const texManager = backend.getTextureManager();
    tf.ENV.registerBackend('test-storage', () => backend);
    tf.setBackend('test-storage');

    const t = tf.Tensor.make([3], {}, 'float32');
    backend.write(t.dataId, new Float32Array([1, 2, 3]));
    const t2 = tf.Tensor.make([3], {}, 'float32');
    backend.write(t2.dataId, new Float32Array([4, 5, 6]));
    expect(texManager.getNumUsedTextures()).toBe(2);
    backend.dispose();
    expect(texManager.getNumUsedTextures()).toBe(0);
  });
});

describeWithFlags('Custom window size', WEBGL_ENVS, () => {
  it('Set screen area to be 1x1', async () => {
    // This will set the screen size to 1x1 to make sure the page limit is
    // very small.
    spyOnProperty(window, 'screen', 'get')
        .and.returnValue({height: 1, width: 1});
    const oldBackend = tf.getBackend();

    tf.ENV.registerBackend('custom-webgl', () => new MathBackendWebGL());
    tf.setBackend('custom-webgl');

    // Allocate a 100x100 tensor.
    const a = tf.ones([100, 100]);
    // No gpu memory used yet because of delayed storage.
    expect((tf.memory() as tf.webgl.WebGLMemoryInfo).numBytesInGPU).toBe(0);

    await a.square().data();
    // Everything got paged out of gpu after the run finished.
    expect((tf.memory() as tf.webgl.WebGLMemoryInfo).numBytesInGPU).toBe(0);

    expectArraysEqual(a, new Float32Array(100 * 100).fill(1));
    tf.setBackend(oldBackend);
    tf.ENV.removeBackend('custom-webgl');
  });
});

// Run only for environments that have 32bit floating point support.
const FLOAT32_WEBGL_ENVS =
    Object.assign({'WEBGL_RENDER_FLOAT32_ENABLED': true}, WEBGL_ENVS);
describeWithFlags('upload tensors as uniforms', FLOAT32_WEBGL_ENVS, () => {
  it('small tensor gets uploaded as scalar', () => {
    let m = tf.memory() as WebGLMemoryInfo;
    expect(m.numBytesInGPU).toBe(0);

    const a = tf.zeros([SIZE_UPLOAD_UNIFORM - 1]);
    a.square();

    // Only the result lives on the gpu, the input is gone.
    m = tf.memory() as WebGLMemoryInfo;
    expect(m.numBytesInGPU).toBe(a.size * 4);
  });

  it('large tensor gets uploaded to gpu', () => {
    let m = tf.memory() as WebGLMemoryInfo;
    expect(m.numBytesInGPU).toBe(0);

    const a = tf.zeros([SIZE_UPLOAD_UNIFORM + 1]);
    a.square();

    // Both the result and the input live on the gpu.
    m = tf.memory() as WebGLMemoryInfo;
    expect(m.numBytesInGPU).toBe(a.size * 4 * 2);
  });

  it('download and re-upload an output of a shader', () => {
    const vals = new Float32Array(SIZE_UPLOAD_UNIFORM + 1);
    vals.fill(2);
    const a = tf.square(vals);
    a.dataSync();            // Download to CPU.
    const res = a.square();  // Re-upload to GPU.

    const expected = new Float32Array(SIZE_UPLOAD_UNIFORM + 1);
    expected.fill(16);
    expectArraysClose(res, expected);
  });
});
