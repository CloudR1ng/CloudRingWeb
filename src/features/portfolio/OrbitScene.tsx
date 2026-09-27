import { useEffect, useRef, type CSSProperties } from 'react'
import * as THREE from 'three'

function seededRandom(seed: number) {
  let value = seed
  return () => { value = (value * 16807) % 2147483647; return (value - 1) / 2147483646 }
}

function gaussian(random: () => number) {
  return random() + random() + random() + random() - 2
}

function createStars(count: number, random: () => number, galaxy: boolean) {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const opacities = new Float32Array(count)
  const colors = new Float32Array(count * 3)
  const centerX = 18
  for (let i = 0; i < count; i++) {
    if (galaxy) {
      const radius = Math.sqrt(random()) * 17
      const arm = Math.floor(random() * 4) * Math.PI / 2
      const angle = arm + radius * .32 + gaussian(random) * .12
      positions[i * 3] = centerX + Math.cos(angle) * radius + gaussian(random) * (.28 + radius * .045)
      positions[i * 3 + 1] = .8 + Math.sin(angle) * radius * .42 + gaussian(random) * (.16 + radius * .025)
      positions[i * 3 + 2] = -9 - random() * 12 + gaussian(random) * .5
      sizes[i] = .3 + Math.pow(random(), 3) * 3.2
      opacities[i] = .16 + random() * .68
    } else {
      positions[i * 3] = gaussian(random) * 26
      positions[i * 3 + 1] = gaussian(random) * 18
      positions[i * 3 + 2] = -22 - random() * 75
      sizes[i] = .28 + Math.pow(random(), 3.5) * 2.8
      opacities[i] = .12 + random() * .62
    }
    const bright = .58 + random() * .42
    colors[i * 3] = bright
    colors[i * 3 + 1] = bright * (.98 + random() * .02)
    colors[i * 3 + 2] = bright * (1.0 + random() * .035)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aSize; attribute float aOpacity; attribute vec3 aColor;
      varying float vOpacity; varying vec3 vColor;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(aSize * (245.0 / max(1.0,-mvPosition.z)), 1.0, 9.0);
        vOpacity = aOpacity; vColor = aColor;
      }
    `,
    fragmentShader: `
      varying float vOpacity; varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - .5);
        float halo = 1.0 - smoothstep(.08,.5,d);
        float core = 1.0 - smoothstep(.0,.12,d);
        gl_FragColor = vec4(vColor, vOpacity * (halo*.36 + core*.64));
      }
    `,
  })
  return new THREE.Points(geometry, material)
}

export default function OrbitScene() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const updateWeights = () => {
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1)
      const progress = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1)
      const smooth = (value:number,start:number,end:number) => {
        const t=THREE.MathUtils.clamp((value-start)/(end-start),0,1)
        return t*t*(3-2*t)
      }
      const first=smooth(progress,.27,.46)
      const second=smooth(progress,.61,.81)
      element.style.setProperty('--cr-scene-hero-weight',String(1-first))
      element.style.setProperty('--cr-scene-dust-weight',String(first*(1-second)))
      element.style.setProperty('--cr-scene-nebula-weight',String(second))
      element.style.setProperty('--cr-scene-drift-x',`${Math.sin(progress*Math.PI*2)*2.2}vw`)
      element.style.setProperty('--cr-scene-drift-y',`${(progress-.5)*1.6}vh`)
    }
    updateWeights()
    window.addEventListener('scroll',updateWeights,{passive:true})
    window.addEventListener('resize',updateWeights)
    return()=>{window.removeEventListener('scroll',updateWeights);window.removeEventListener('resize',updateWeights)}
  },[])
  useEffect(() => {
    const element = host.current
    if (!element) return
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'low-power' })
    } catch {
      element.classList.add('cr-scene-fallback')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35))
    renderer.setSize(element.clientWidth, element.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(0x000000, 1)
    element.appendChild(renderer.domElement)
    let textureFailed = false
    let contextUnavailable = false
    let sceneReady = false
    const syncFallback = () => {
      const fallback = motionPreference.matches || textureFailed || contextUnavailable
      element.classList.toggle('cr-scene-fallback', fallback)
      renderer.domElement.style.visibility = fallback || !sceneReady ? 'hidden' : 'visible'
    }
    syncFallback()

    const scene = new THREE.Scene()
    scene.background = null
    const camera = new THREE.PerspectiveCamera(44, element.clientWidth / element.clientHeight, .1, 160)
    const cameraPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 25), new THREE.Vector3(.2, .6, 23),
      new THREE.Vector3(-.4, -.4, 21), new THREE.Vector3(.5, -2.4, 19),
      new THREE.Vector3(-.4, -4.6, 17),
    ])

    let disposed = false
    let texturesLoaded = 0
    const loader=new THREE.TextureLoader()
    const galaxyTextures=['galaxy-silver-v1.png','galaxy-dust-v1.png','galaxy-nebula-v1.png'].map(file=>loader.load(
      `${import.meta.env.BASE_URL}backgrounds/${file}`,
      () => {
        if(disposed)return
        texturesLoaded+=1
        if(texturesLoaded===3){sceneReady=true;syncFallback();scheduleRender()}
      },
      undefined,
      () => { if (!disposed) { textureFailed = true; syncFallback() } },
    ))
    for(const texture of galaxyTextures){
      texture.colorSpace=THREE.SRGBColorSpace
      texture.wrapS=THREE.ClampToEdgeWrapping
      texture.wrapT=THREE.ClampToEdgeWrapping
    }
    const backgroundScene=new THREE.Scene()
    const backgroundCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,2)
    backgroundCamera.position.z=1
    const galaxyMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: {
        uHero:{value:galaxyTextures[0]},uDust:{value:galaxyTextures[1]},uNebula:{value:galaxyTextures[2]},
        uWeights:{value:new THREE.Vector3(1,0,0)},uOffset:{value:new THREE.Vector2(0,0)},uOpacity:{value:.95},
        uViewport:{value:new THREE.Vector2(1,1)},uImageAspect:{value:1672/941},
        uHeroFocus:{value:new THREE.Vector2(.72,.6)},uDustFocus:{value:new THREE.Vector2(0,.56)},uNebulaFocus:{value:new THREE.Vector2(.06,.8)},
      },
      depthTest:false, blending:THREE.NormalBlending,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform sampler2D uHero; uniform sampler2D uDust; uniform sampler2D uNebula;
        uniform vec3 uWeights; uniform vec2 uOffset; uniform float uOpacity; varying vec2 vUv;
        uniform vec2 uViewport; uniform float uImageAspect;
        uniform vec2 uHeroFocus; uniform vec2 uDustFocus; uniform vec2 uNebulaFocus;
        vec2 coverUv(vec2 uv,vec2 focus,vec2 drift){
          float viewportAspect=uViewport.x/max(uViewport.y,1.0);
          vec2 visible=vec2(1.0);
          if(viewportAspect<uImageAspect){
            visible.x=(viewportAspect/uImageAspect)/1.04;
          }else{
            visible.y=(uImageAspect/viewportAspect)/1.04;
          }
          vec2 origin=clamp((1.0-visible)*focus+drift,vec2(0.0),1.0-visible);
          return origin+uv*visible;
        }
        vec4 layer(sampler2D map,vec2 focus,float weight,float shift){
          vec2 point=coverUv(vUv,focus,uOffset*shift);
          vec4 texel=texture2D(map,point);
          float edge=min(min(point.x,1.0-point.x),min(point.y,1.0-point.y));
          float feather=smoothstep(0.0,.012,edge);
          float light=dot(texel.rgb,vec3(.2126,.7152,.0722));
          float detail=smoothstep(.008,.115,light);
          float alpha=detail*feather*weight;
          return vec4(texel.rgb,alpha);
        }
        void main(){
          vec4 a=layer(uHero,uHeroFocus,uWeights.x,1.0);
          vec4 b=layer(uDust,uDustFocus,uWeights.y,1.7);
          vec4 c=layer(uNebula,uNebulaFocus,uWeights.z,2.4);
          float coverage=max(a.a+b.a+c.a,.001);
          float alpha=min(1.0,coverage*uOpacity);
          vec3 color=(a.rgb*a.a+b.rgb*b.a+c.rgb*c.a)/coverage;
          gl_FragColor=vec4(color,alpha);
        }
      `,
    })
    const galaxy = new THREE.Mesh(new THREE.PlaneGeometry(2,2),galaxyMaterial)
    galaxy.frustumCulled=false
    galaxy.renderOrder=-1000
    backgroundScene.add(galaxy)

    const random = seededRandom(8341)
    const farStars = createStars(3600, random, false)
    const galaxyStars = createStars(3400, random, true)
    scene.add(farStars, galaxyStars)
    const ambient = new THREE.PointLight(0xdde1e7, .5, 42, 2)
    const coreLight = new THREE.PointLight(0xe4e7ec, 1.7, 34, 2)
    scene.add(ambient, coreLight)

    let frame = 0
    let inView = true
    const render = () => {
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1)
      const progress = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1)
      const smooth = (value:number,start:number,end:number) => {
        const t=THREE.MathUtils.clamp((value-start)/(end-start),0,1)
        return t*t*(3-2*t)
      }
      const first=smooth(progress,.27,.46)
      const second=smooth(progress,.61,.81)
      galaxyMaterial.uniforms.uWeights.value.set(1-first,first*(1-second),second)
      galaxyMaterial.uniforms.uOffset.value.set(progress*.035,Math.sin(progress*Math.PI*2)*.018)
      galaxyMaterial.uniforms.uViewport.value.set(element.clientWidth,element.clientHeight)
      const position = cameraPath.getPointAt(progress)
      const forward = cameraPath.getTangentAt(progress).normalize()
      camera.position.copy(position)
      camera.lookAt(position.clone().addScaledVector(forward, 12))
      farStars.position.set(-progress * 1.5, progress * 2.0, progress * 1.2)
      galaxyStars.position.set(-progress * 2.5, progress * 1.25, progress * 1.8)
      galaxyMaterial.uniforms.uOpacity.value = THREE.MathUtils.lerp(.88,.82,THREE.MathUtils.smoothstep(progress,.27,.81))
      coreLight.position.set(18 - position.x, 1.4 - position.y, -7 - position.z * .18)
      renderer.autoClear=false
      renderer.clear(true,true,true)
      renderer.render(backgroundScene,backgroundCamera)
      renderer.clearDepth()
      renderer.render(scene,camera)
    }
    const scheduleRender = () => {
      if (disposed || motionPreference.matches || textureFailed || contextUnavailable || !inView || document.visibilityState !== 'visible' || frame) return
      frame = requestAnimationFrame(() => { frame = 0; render() })
    }
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return
      camera.aspect = element.clientWidth / element.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(element.clientWidth, element.clientHeight)
      galaxyMaterial.uniforms.uViewport.value.set(element.clientWidth,element.clientHeight)
      scheduleRender()
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden' && frame) { cancelAnimationFrame(frame); frame = 0 }
      else scheduleRender()
    }
    const motionChange = () => {
      syncFallback()
      if (motionPreference.matches && frame) { cancelAnimationFrame(frame); frame = 0 }
      else scheduleRender()
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      contextUnavailable = true
      syncFallback()
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
    }
    const contextRestored = () => {
      contextUnavailable = false
      syncFallback()
      scheduleRender()
    }
    renderer.domElement.addEventListener('webglcontextlost', contextLost)
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored)
    motionPreference.addEventListener('change', motionChange)
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      if (inView) scheduleRender()
      else if (frame) { cancelAnimationFrame(frame); frame = 0 }
    })
    observer.observe(element)
    window.addEventListener('scroll', scheduleRender, { passive: true })
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', visibility)
    scheduleRender()

    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', scheduleRender)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibility)
      motionPreference.removeEventListener('change', motionChange)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored)
      for (const object of [galaxy, farStars, galaxyStars]) {
        object.geometry.dispose()
        const material = object.material
        for (const item of Array.isArray(material) ? material : [material]) item.dispose()
      }
      for(const texture of galaxyTextures)texture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])
  const imageUrl=(name:string)=>`url("${import.meta.env.BASE_URL}backgrounds/${name}")`
  const style={
    '--cr-galaxy-image':imageUrl('galaxy-silver-v1.png'),
    '--cr-dust-image':imageUrl('galaxy-dust-v1.png'),
    '--cr-nebula-image':imageUrl('galaxy-nebula-v1.png'),
  } as CSSProperties
  return <div className="cr-scene" ref={host} aria-hidden="true" style={style}><div className="cr-scene-static"><i className="cr-scene-image cr-scene-image-hero"/><i className="cr-scene-image cr-scene-image-dust"/><i className="cr-scene-image cr-scene-image-nebula"/></div></div>
}
