// Enhanced Intersection Observer for animations
document.addEventListener("DOMContentLoaded", () => {
    const sections = document.querySelectorAll(".section");
    const cards = document.querySelectorAll(".card");
    
    // Section animations
    const sectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
        }
      });
    }, { 
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px"
    });
  
    sections.forEach(section => sectionObserver.observe(section));
  
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
  
    // Add interactive hover effects to hero background
    document.addEventListener('mousemove', (e) => {
      const hero = document.querySelector('.hero');
      if (hero && hero.contains(e.target)) {
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        hero.style.background = `linear-gradient(135deg, 
          hsl(${210 + x * 10}, 90%, ${15 + y * 5}%) 0%, 
          hsl(${210 + x * 15}, 80%, ${20 + y * 8}%) 100%)`;
      }
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
  });