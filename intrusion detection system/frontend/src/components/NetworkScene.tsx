import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const N = 150
const CYAN = new THREE.Color('#22d3ee')
const MAGENTA = new THREE.Color('#ff2bd6')

function Network() {
  const group = useRef<THREE.Group>(null!)
  const nodes = useRef<THREE.InstancedMesh>(null!)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const { pos, anomalous, lines } = useMemo(() => {
    const pos: THREE.Vector3[] = []
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(2.2 + Math.random() * 2.2)
      v.y *= 0.7
      pos.push(v)
    }
    const anomalous = new Set<number>()
    while (anomalous.size < 8) anomalous.add(Math.floor(Math.random() * N))
    const arr: number[] = []
    pos.forEach((p, i) => {
      pos
        .map((q, j) => [j, p.distanceToSquared(q)] as const)
        .filter(([j]) => j !== i)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2)
        .forEach(([j]) => {
          if (i < j || !pos[j]) arr.push(p.x, p.y, p.z, pos[j].x, pos[j].y, pos[j].z)
        })
    })
    return { pos, anomalous, lines: new Float32Array(arr) }
  }, [])

  const setup = (m: THREE.InstancedMesh | null) => {
    if (!m) return
    nodes.current = m
    pos.forEach((p, i) => {
      dummy.position.copy(p)
      dummy.scale.setScalar(anomalous.has(i) ? 1.6 : 1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      m.setColorAt(i, anomalous.has(i) ? MAGENTA : CYAN)
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }

  useFrame(({ clock, pointer }, dt) => {
    const t = clock.elapsedTime
    group.current.rotation.y += dt * 0.08
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, pointer.y * 0.25, 0.05)
    group.current.position.x = THREE.MathUtils.lerp(group.current.position.x, pointer.x * 0.4, 0.05)
    let k = 0
    anomalous.forEach((i) => {
      const s = 1.6 + Math.sin(t * 3 + k++) * 0.6
      dummy.position.copy(pos[i])
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      nodes.current.setMatrixAt(i, dummy.matrix)
    })
    nodes.current.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={group}>
      <instancedMesh ref={setup} args={[undefined, undefined, N]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#22d3ee" transparent opacity={0.18} />
      </lineSegments>
    </group>
  )
}

export default function NetworkScene() {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 8], fov: 55 }} gl={{ antialias: false, powerPreference: 'high-performance' }}>
      <Network />
    </Canvas>
  )
}
