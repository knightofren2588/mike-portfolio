// Enhanced Intersection Observer for animations
document.addEventListener("DOMContentLoaded", () => {
    const cards = document.querySelectorAll(".card");
    
    // Staggered card animations
    const cardObserver = new IntersectionObserver(entries => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";
          }, index * 100);
          cardObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
  
    cards.forEach(card => {
      card.style.opacity = "0";
      card.style.transform = "translateY(30px)";
      card.style.transition = "all 0.6s ease";
      cardObserver.observe(card);
    });
  
    // Smooth scrolling for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      });
    });

    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');

    if (hamburger && mobileMenu) {
      hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('open');
        mobileMenu.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', hamburger.classList.contains('open') ? 'true' : 'false');
      });

      document.querySelectorAll('.mobile-link').forEach(link => {
        link.addEventListener('click', () => {
          hamburger.classList.remove('open');
          mobileMenu.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
        });
      });

      document.addEventListener('click', (e) => {
        if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
          hamburger.classList.remove('open');
          mobileMenu.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
        }
      });
    }
  
    // Add scroll effect to sticky nav
    let lastScrollY = window.scrollY;
    window.addEventListener('scroll', () => {
      const nav = document.querySelector('.sticky-nav');
      if (window.scrollY > lastScrollY && window.scrollY > 100) {
        nav.style.transform = 'translateY(-100%)';
      } else {
        nav.style.transform = 'translateY(0)';
      }
      lastScrollY = window.scrollY;
    });
  
    // Loading animation
    document.body.classList.add('loading');
  
    // Skill badge interactions
    document.querySelectorAll('.skill-badge').forEach(badge => {
      badge.addEventListener('mouseenter', function() {
        this.style.transform = 'scale(1.1) rotate(2deg)';
      });
      
      badge.addEventListener('mouseleave', function() {
        this.style.transform = 'scale(1) rotate(0deg)';
      });
    });
  
    // Performance optimization: Throttle scroll events
    function throttle(func, limit) {
      let inThrottle;
      return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
          func.apply(context, args);
          inThrottle = true;
          setTimeout(() => inThrottle = false, limit);
        }
      }
    }
  
    // Apply throttling to scroll event
    window.addEventListener('scroll', throttle(() => {
      // Existing scroll logic is already handled above
    }, 16)); // ~60fps
  
    console.log('StarkTech Studios - Website loaded successfully! 🚀');

    // ── Typing Animation ──
    const typingEl = document.getElementById('typing-text');
    if (typingEl) {
      const roles = [
        'Software Developer',
        'AI Developer',
        'IT Expert',
        'Content Creator',
        'World Builder'
      ];
      let roleIndex = 0;
      let charIndex = 0;
      let isDeleting = false;
    
      function typeLoop() {
        const current = roles[roleIndex];
        if (isDeleting) {
          typingEl.textContent = current.substring(0, charIndex - 1);
          charIndex--;
        } else {
          typingEl.textContent = current.substring(0, charIndex + 1);
          charIndex++;
        }
    
        let speed = isDeleting ? 60 : 110;
    
        if (!isDeleting && charIndex === current.length) {
          speed = 1800;
          isDeleting = true;
        } else if (isDeleting && charIndex === 0) {
          isDeleting = false;
          roleIndex = (roleIndex + 1) % roles.length;
          speed = 400;
        }
        setTimeout(typeLoop, speed);
      }
      typeLoop();
    }
    
    // ── Animated Stat Counters ──
    function animateCounters() {
      document.querySelectorAll('.stat-num').forEach(el => {
        const target = parseInt(el.getAttribute('data-target') || el.textContent);
        const suffix = el.textContent.replace(/[0-9]/g, '');
        let count = 0;
        const duration = 1800;
        const steps = 50;
        const increment = target / steps;
        const timer = setInterval(() => {
          count += increment;
          if (count >= target) {
            el.textContent = target + suffix;
            clearInterval(timer);
          } else {
            el.textContent = Math.floor(count) + suffix;
          }
        }, duration / steps);
      });
    }
    
    // Trigger counters when hero stats come into view
    const statsObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounters();
          statsObserver.disconnect();
        }
      });
    }, { threshold: 0.5 });
    
    const statsEl = document.querySelector('.hero-stats');
    if (statsEl) statsObserver.observe(statsEl);
    
    // ── Particle Canvas ──
    const heroCanvas = document.getElementById('hero-particles');
    if (heroCanvas) {
      const ctx = heroCanvas.getContext('2d');
    
      function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = heroCanvas.getBoundingClientRect();
        heroCanvas.width = Math.floor(rect.width * dpr);
        heroCanvas.height = Math.floor(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);
    
      const particles = Array.from({ length: 70 }, () => ({
        x: Math.random() * heroCanvas.getBoundingClientRect().width,
        y: Math.random() * heroCanvas.getBoundingClientRect().height,
        r: Math.random() * 1.4 + 0.3,
        dx: (Math.random() - 0.5) * 0.35,
        dy: (Math.random() - 0.5) * 0.35,
        alpha: Math.random() * 0.4 + 0.1
      }));
    
      function drawParticles() {
        const rect = heroCanvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
        particles.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0, 212, 255, ${p.alpha})`;
          ctx.fill();
          p.x += p.dx;
          p.y += p.dy;
          if (p.x < 0 || p.x > rect.width) p.dx *= -1;
          if (p.y < 0 || p.y > rect.height) p.dy *= -1;
        });
        requestAnimationFrame(drawParticles);
      }
      drawParticles();
    }
    
    // ── Back to Top ──
    const backToTop = document.getElementById('backToTop');
    if (backToTop) {
      window.addEventListener('scroll', () => {
        if (window.scrollY > 400) {
          backToTop.classList.add('visible');
        } else {
          backToTop.classList.remove('visible');
        }
      });
      backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    
    // ── Scroll Reveal ──
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1 });
    
    document.querySelectorAll('.section').forEach(el => revealObserver.observe(el));
  });