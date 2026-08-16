import { useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import { state, inputs } from '../state'
import Section from './Section'
import { makeCausticsTexture, makeConcreteTexture, roughnessFromColour } from './textures'

/**
 * The TRIGA pool, seen from the rail.
 *
 * This variant is built first because it is the only one where Cherenkov light
 * is honestly visible (PLAN.md §2): a TRIGA sits open in a water pool and the
 * blue glow is what you would actually see standing over it. A PWR core is
 * behind 200 mm of steel, and showing its glow would be a lie dressed as a
 * render.
 *
 * Cherenkov light is emitted when a charged particle exceeds the phase velocity
 * of light in the medium — in water, n = 1.33, so 0.75c. The source is beta
 * particles from fission products and Compton electrons from gammas. Spectral
 * intensity goes as 1/λ², which is why it rises into the UV and the visible
 * tail reads blue.
 */

/**
 * TRIGA fuel positions: a central element with concentric rings B–F.
 * 91 elements, which is a full Mark II core loading.
 */
const RINGS = [
  { count: 6, radius: 0.41 },
  { count: 12, radius: 0.82 },
  { count: 18, radius: 1.23 },
  { count: 24, radius: 1.64 },
  { count: 30, radius: 2.05 },
]

function latticePositions() {
  const out: [number, number][] = [[0, 0]]
  for (const ring of RINGS) {
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2 + (ring.count % 12) * 0.05
      out.push([Math.cos(a) * ring.radius, Math.sin(a) * ring.radius])
    }
  }
  return out
}

const FUEL_LENGTH = 1.9
const CORE_Y = 0

function FuelLattice() {
  const positions = useMemo(latticePositions, [])
  const mesh = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(
    () => new THREE.CylinderGeometry(0.085, 0.085, FUEL_LENGTH, 14),
    [],
  )

  /**
   * Stainless cladding.
   *
   * metalness is deliberately 0.65 rather than 1.0. A fully metallic surface has
   * no diffuse component at all — it is a pure mirror, so it shows only what
   * surrounds it, and in a scene without an environment map that means it
   * renders black. That is exactly what the first pass did: 91 black sticks.
   *
   * The Environment below is the real fix, but keeping a little diffuse in the
   * material means the lattice still reads if the cubemap is ever dimmed for a
   * mood, rather than collapsing to silhouette.
   */
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: '#aab4c0',
      metalness: 0.65,
      roughness: 0.32,
      envMapIntensity: 1.4,
    }),
    [],
  )

  // Placed once, before first paint. An InstancedMesh starts with all-zero
  // matrices, which collapse every element onto the origin — so this cannot wait
  // for a frame callback or the first rendered frame shows a single blob.
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const dummy = new THREE.Object3D()
    positions.forEach(([x, z], i) => {
      dummy.position.set(x, CORE_Y, z)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [positions])

  return (
    <instancedMesh ref={mesh} args={[geometry, material, positions.length]} castShadow receiveShadow />
  )
}

/**
 * How much of the structure is cut away, and where.
 *
 * A real graphite reflector is a closed annulus around the fuel, and a real
 * upper grid plate is a solid perforated disc. Modelled faithfully, they seal
 * the core inside a drum with a lid and the lattice becomes invisible — which is
 * exactly what the first pass did.
 *
 * So the structure is sectioned, facing the camera. This is not a compromise: it
 * is the cutaway convention every reactor diagram uses, and PLAN.md §9 rule 3
 * already requires the view to read as a diagram rather than a photograph.
 *
 * The camera orbits gently around +Z, so the opening is centred there. In
 * three.js a cylinder's theta runs from +Z, so a solid span starting at
 * OPENING/2 and running the rest of the way leaves the gap facing us.
 */
const OPENING = Math.PI * 0.82 // ~148° removed
const SOLID_START = OPENING / 2
const SOLID_LENGTH = Math.PI * 2 - OPENING

/** Graphite reflector: the ring that keeps neutrons in the core. Sectioned. */
function Reflector() {
  const graphite = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: '#31353b',
      metalness: 0.05,
      roughness: 0.88,
      side: THREE.DoubleSide,
    }),
    [],
  )
  // The cut faces, so the ring reads as a solid block in section rather than as
  // a curved sheet of paper.
  const cutFace = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#4a4f57', metalness: 0.05, roughness: 0.75 }),
    [],
  )
  const height = FUEL_LENGTH * 0.98
  const rIn = 2.32
  const rOut = 2.62

  return (
    <group position={[0, CORE_Y, 0]}>
      <mesh material={graphite} receiveShadow>
        <cylinderGeometry args={[rOut, rOut, height, 48, 1, true, SOLID_START, SOLID_LENGTH]} />
      </mesh>
      <mesh material={graphite}>
        <cylinderGeometry args={[rIn, rIn, height, 48, 1, true, SOLID_START, SOLID_LENGTH]} />
      </mesh>
      {/* Top and bottom annular faces of the ring. */}
      {[height / 2, -height / 2].map((y, i) => (
        <mesh key={i} material={graphite} position={[0, y, 0]} rotation={[i === 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0]}>
          <ringGeometry args={[rIn, rOut, 48, 1, i === 0 ? SOLID_START : -SOLID_START - SOLID_LENGTH, SOLID_LENGTH]} />
        </mesh>
      ))}
      {/* The two radial faces where the section was taken. */}
      {[SOLID_START, SOLID_START + SOLID_LENGTH].map((theta, i) => (
        <mesh
          key={i}
          material={cutFace}
          position={[Math.sin(theta) * (rIn + rOut) / 2, 0, Math.cos(theta) * (rIn + rOut) / 2]}
          rotation={[0, theta, 0]}
        >
          <planeGeometry args={[rOut - rIn, height]} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Grid plates.
 *
 * The upper plate is an annulus rather than a disc. A real one is a perforated
 * disc — a hole for every element — but a solid disc modelled here is a lid that
 * hides the entire lattice from any camera above the midplane. The rim carries
 * the same structural read without capping the view.
 */
function GridPlates() {
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: '#7d8794',
      metalness: 0.72,
      roughness: 0.4,
      envMapIntensity: 1.2,
      side: THREE.DoubleSide,
    }),
    [],
  )
  return (
    <group>
      <mesh material={material} position={[0, FUEL_LENGTH / 2 + 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <ringGeometry args={[2.16, 2.5, 48]} />
      </mesh>
      <mesh material={material} position={[0, -FUEL_LENGTH / 2 - 0.08, 0]} receiveShadow>
        <cylinderGeometry args={[2.5, 2.5, 0.12, 48]} />
      </mesh>
    </group>
  )
}

/**
 * Cherenkov, in three layers.
 *
 * One glowing shape reads as a lamp. Real Cherenkov light fills the water
 * between and around the elements and falls off through it, so it needs a
 * source, a volume and a halo:
 *
 *   core   — a bright column in the lattice itself
 *   volume — a larger, softer shell where the water is lit
 *   halo   — the outermost falloff, almost all colour and no brightness
 *
 * Intensity follows power^0.4, not power. The eye's response is logarithmic, so
 * a linear mapping makes the entire approach to criticality invisible and then
 * blows out in a single step — which is backwards, because the climb is the
 * story this page is telling.
 *
 * `toneMapped: false` is load-bearing. ACES clamps brightness but hue survives
 * it, so a saturated colour driven past 1.0 reads as luminous where a bright
 * white one only reads as a flat pale shape.
 */
function Cherenkov() {
  const core = useRef<THREE.Mesh>(null)
  const volume = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const up = useRef<THREE.PointLight>(null)

  const mk = (color: string, opacity: number, side: THREE.Side = THREE.FrontSide) =>
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side,
      toneMapped: false,
    })

  // Distinctly blue, not white. Cherenkov intensity goes as 1/λ², so the
  // visible tail is blue by construction — a white core reads as a fluorescent
  // tube. Only the centre of the column should approach white, and only at high
  // power, which the additive layering produces on its own.
  const coreMat = useMemo(() => mk('#78c8ff', 0), [])
  const volumeMat = useMemo(() => mk('#2b86f0', 0, THREE.BackSide), [])
  const haloMat = useMemo(() => mk('#0d47b8', 0, THREE.BackSide), [])

  useFrame((st) => {
    const s = state()
    const p = Math.max(s.powerFraction, 1e-12)
    const glow = Math.min(1, Math.pow(p, 0.4) * 1.3)

    // A live core is never perfectly steady — the boiling and flow in the pool
    // make the light breathe. Tied to the clock rather than to power so it does
    // not read as instability in the simulation.
    const t = st.clock.elapsedTime
    const shimmer = 1 + Math.sin(t * 2.3) * 0.03 + Math.sin(t * 5.7) * 0.015

    coreMat.opacity = Math.min(0.72, glow * 0.62) * shimmer
    volumeMat.opacity = Math.min(0.42, glow * 0.3) * shimmer
    haloMat.opacity = Math.min(0.28, glow * 0.19)

    // The point light was washing the steel cladding to white, which is what
    // made the lattice read as lit tubes rather than as metal standing in
    // glowing water. The glow should light the water, not blow out the rods.
    if (light.current) light.current.intensity = glow * 13 * shimmer
    if (up.current) up.current.intensity = glow * 12

    if (volume.current) {
      const k = 1 + glow * 0.22
      volume.current.scale.set(k, 1, k)
    }
    if (halo.current) {
      const k = 1 + glow * 0.4
      halo.current.scale.setScalar(k)
    }
  })

  return (
    <group position={[0, CORE_Y, 0]}>
      <mesh ref={core} material={coreMat}>
        <cylinderGeometry args={[2.15, 2.15, FUEL_LENGTH * 1.02, 40, 1, true]} />
      </mesh>
      <mesh ref={volume} material={volumeMat}>
        <cylinderGeometry args={[2.9, 2.9, FUEL_LENGTH * 1.5, 40, 1, true]} />
      </mesh>
      <mesh ref={halo} material={haloMat}>
        <sphereGeometry args={[3.8, 28, 20]} />
      </mesh>

      <pointLight ref={light} color="#5cc0ff" distance={20} decay={2} />
      {/* A second light high above, so the glow reaches the water surface and
          the pool wall rather than stopping at the lattice. */}
      <pointLight ref={up} color="#3f9dff" distance={26} decay={1.6} position={[0, 3.4, 0]} />
    </group>
  )
}

/** Control rods, entering from above and driven by the operator's own input. */
function ControlRods() {
  const group = useRef<THREE.Group>(null)
  const rod = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#242830', metalness: 0.8, roughness: 0.3, envMapIntensity: 1.2 }),
    [],
  )
  const shaft = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#8d97a3', metalness: 0.85, roughness: 0.28, envMapIntensity: 1.3 }),
    [],
  )
  const positions = useMemo(
    () => [0, 1, 2].map((k) => {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 6
      return [Math.cos(a) * 0.62, Math.sin(a) * 0.62] as [number, number]
    }),
    [],
  )

  useFrame(() => {
    if (!group.current) return
    const i = inputs()
    const withdrawal = i.scrammed ? 0 : i.rodWithdrawal
    group.current.position.y = withdrawal * (FUEL_LENGTH + 0.3)
  })

  return (
    <group ref={group}>
      {positions.map(([x, z], k) => (
        <group key={k} position={[x, 0, z]}>
          <mesh material={rod} position={[0, CORE_Y, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, FUEL_LENGTH * 1.05, 14]} />
          </mesh>
          {/* Drive shaft running up out of the water. Without it the rods look
              like they are floating rather than being held. */}
          <mesh material={shaft} position={[0, FUEL_LENGTH / 2 + 2.6, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 5.2, 10]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/**
 * The pool itself: concrete shaft, floor, and the caustics the surface throws.
 *
 * This is most of what was missing. Without a wall and a floor the core floats
 * in a void, and the eye has nothing to judge scale or depth against.
 */
function PoolStructure() {
  const concrete = useMemo(makeConcreteTexture, [])
  const concreteRough = useMemo(() => roughnessFromColour(concrete), [concrete])
  const caustics = useMemo(() => makeCausticsTexture(), [])
  const causticsRef = useRef<THREE.MeshBasicMaterial>(null)

  const wallMat = useMemo(() => {
    concrete.repeat.set(6, 3)
    concreteRough.repeat.set(6, 3)
    return new THREE.MeshStandardMaterial({
      map: concrete,
      roughnessMap: concreteRough,
      color: '#5c6672',
      roughness: 1,
      metalness: 0,
      side: THREE.BackSide,
    })
  }, [concrete, concreteRough])

  const floorMat = useMemo(() => {
    const map = concrete.clone()
    map.repeat.set(3, 3)
    map.needsUpdate = true
    return new THREE.MeshStandardMaterial({ map, color: '#4e5763', roughness: 0.95, metalness: 0 })
  }, [concrete])

  // Caustics drift, because a still pattern reads as a painted floor.
  useFrame((st) => {
    const t = st.clock.elapsedTime
    caustics.offset.set(Math.sin(t * 0.045) * 0.35 + t * 0.012, Math.cos(t * 0.037) * 0.35)
    if (causticsRef.current) {
      // They fade as the core brightens: once Cherenkov dominates, sunlight
      // from the hall is no longer what is lighting the floor.
      const glow = Math.min(1, Math.pow(Math.max(state().powerFraction, 1e-12), 0.4) * 1.3)
      causticsRef.current.opacity = 0.5 * (1 - glow * 0.75)
    }
  })

  return (
    <group>
      {/* Shaft wall. BackSide, so we are inside it. */}
      <mesh material={wallMat} position={[0, 1, 0]}>
        <cylinderGeometry args={[7.5, 7.5, 16, 48, 1, true]} />
      </mesh>

      <mesh material={floorMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.6, 0]} receiveShadow>
        <circleGeometry args={[7.5, 48]} />
      </mesh>

      {/* Caustics, projected additively onto the floor. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.57, 0]}>
        <circleGeometry args={[7.5, 48]} />
        <meshBasicMaterial
          ref={causticsRef}
          map={caustics}
          transparent
          opacity={0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

/**
 * The water surface, seen from below.
 *
 * A single plane with a slow ripple in the vertex shader. It matters more than
 * it sounds: it is the only thing in frame that establishes there IS a surface,
 * and therefore that everything below it is underwater rather than in air.
 */
function WaterSurface() {
  const mesh = useRef<THREE.Mesh>(null)
  const geometry = useMemo(() => new THREE.PlaneGeometry(15, 15, 40, 40), [])
  const base = useMemo(() => Float32Array.from(geometry.attributes.position.array), [geometry])

  useFrame((st) => {
    const g = mesh.current?.geometry as THREE.PlaneGeometry | undefined
    if (!g) return
    const pos = g.attributes.position
    const t = st.clock.elapsedTime
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]
      const y = base[i * 3 + 1]
      pos.setZ(
        i,
        Math.sin(x * 0.8 + t * 0.9) * 0.06 +
          Math.sin(y * 1.1 - t * 0.7) * 0.05 +
          Math.sin((x + y) * 0.5 + t * 1.4) * 0.03,
      )
    }
    pos.needsUpdate = true
    g.computeVertexNormals()
  })

  return (
    <mesh ref={mesh} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 5.4, 0]}>
      <meshStandardMaterial
        color="#7fb4d8"
        transparent
        opacity={0.28}
        roughness={0.08}
        metalness={0.2}
        side={THREE.DoubleSide}
        envMapIntensity={2}
      />
    </mesh>
  )
}

/** Slow drift, so a still reactor is not a still image. */
function Rig() {
  // Read once. A visitor who asked for less motion should get a fixed camera,
  // not the same camera moving anyway — and the scene still conveys everything
  // it needs to, because the information is in the glow and the rods, not in
  // the orbit.
  const still = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ).current

  useFrame((s) => {
    if (still) {
      s.camera.position.set(0, 1.55, 5.6)
      s.camera.lookAt(0, 0.05, 0)
      return
    }
    const t = s.clock.elapsedTime
    // Low and side-on, ~15 degrees above the midplane.
    //
    // Looking DOWN at the core showed the top of it: a grid plate and the ring
    // of the reflector, with the entire lattice hidden underneath. The fuel is
    // vertical and the Cherenkov column is vertical, so both only read from
    // roughly the side.
    //
    // The orbit is kept small so the sectioned opening stays facing the camera.
    const r = 5.6
    const a = Math.sin(t * 0.055) * 0.2
    s.camera.position.set(Math.sin(a) * r, 1.55 + Math.sin(t * 0.08) * 0.14, Math.cos(a) * r)
    s.camera.lookAt(0, 0.05, 0)
  })
  return null
}

/**
 * Lighting.
 *
 * The Environment is the single most important thing here, and its absence was
 * why the first pass rendered 91 black sticks. Polished metal has no colour of
 * its own — it only shows what surrounds it — so a metal-heavy scene with no
 * cubemap renders black no matter how many lights are added. More intensity
 * cannot fix it; only something to reflect can.
 *
 * Built from Lightformers rather than an HDR preset, because a preset pulls a
 * file off a CDN at runtime and this page makes no network requests.
 */
function Studio() {
  return (
    <>
      <Environment resolution={256} background={false}>
        {/* The hall above: a big cool skylight, which is what actually lights a
            university reactor room. */}
        <Lightformer form="rect" intensity={5} color="#eaf4ff" position={[0, 12, 0]} scale={[16, 16, 1]} rotation={[-Math.PI / 2, 0, 0]} />
        {/* Two side panels at different temperatures. Two colours in the
            reflections is what stops steel reading as flat grey. */}
        <Lightformer form="rect" intensity={2.4} color="#cfe2f5" position={[-9, 3, 3]} scale={[5, 12, 1]} rotation={[0, Math.PI / 2.4, 0]} />
        <Lightformer form="rect" intensity={2} color="#f5eede" position={[9, 2, -2]} scale={[5, 12, 1]} rotation={[0, -Math.PI / 2.4, 0]} />
        {/* Bounce from the pool floor, so undersides are not solid black. */}
        <Lightformer form="rect" intensity={1.4} color="#4e6c86" position={[0, -6, 0]} scale={[14, 14, 1]} rotation={[Math.PI / 2, 0, 0]} />
      </Environment>

      <ambientLight intensity={0.35} color="#bcd4e8" />
      <directionalLight
        position={[4, 12, 5]}
        intensity={1.7}
        color="#eaf2ff"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <directionalLight position={[-5, 3, -4]} intensity={0.3} color="#78a6c8" />
    </>
  )
}

/**
 * Is WebGL actually available?
 *
 * Checked once, before mounting the Canvas. Without it, a machine with WebGL
 * disabled gets a silent black rectangle with no error to explain it — invisible
 * to the author, total for the visitor. It costs nothing to degrade well,
 * because the 3D view is the ONLY part of this page that needs a GPU.
 */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export type PoolProps = { view: 'section' | 'pool' }

export default function Pool({ view }: PoolProps) {
  const supported = useRef(hasWebGL()).current

  // The section is the default (see Section.tsx): the project's job is to be
  // understood, and a labelled diagram teaches where an atmospheric render only
  // impresses. The 3D view is offered alongside it, and is the only thing here
  // that needs a GPU — so when WebGL is missing, nothing is actually lost.
  if (view === 'section' || !supported) {
    return (
      <div className="pool pool--section">
        <Section />
        {!supported && view === 'pool' && (
          <p className="section-note">
            This browser has WebGL disabled, so the 3D pool cannot be drawn. The
            section is fully live — the glow tracks power and the rods track your
            input.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="pool">
      <Canvas
        dpr={[1, 1.75]}
        shadows
        camera={{ position: [0, 1.55, 5.6], fov: 38, near: 0.1, far: 80 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.05
          gl.outputColorSpace = THREE.SRGBColorSpace
        }}
      >
        {/*
          Exponential fog in the water's own colour. This is what sells "deep
          pool" rather than "objects on a dark background": distance reads as
          colour, so the wall behind the core recedes instead of sitting flat
          against it. It is also physically the right story — water attenuates
          red first, which is why everything far away in a pool goes blue.
        */}
        <fogExp2 attach="fog" args={['#124459', 0.05]} />
        <color attach="background" args={['#0d2f42']} />

        <Studio />
        <PoolStructure />
        <Reflector />
        <GridPlates />
        <FuelLattice />
        <ControlRods />
        <Cherenkov />
        <WaterSurface />
        <Rig />
      </Canvas>
    </div>
  )
}
