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

    const typingText = document.getElementById('typingText');
    const typingPhrases = [
      "Software Developer",
      "AI Developer",
      "IT Expert",
      "Content Creator",
      "React Developer",
      "Licensed Massage Therapist",
    ];

    if (typingText) {
      let phraseIndex = 0;
      let charIndex = 0;
      let isDeleting = false;

      const type = () => {
        const phrase = typingPhrases[phraseIndex];

        if (isDeleting) {
          charIndex = Math.max(0, charIndex - 1);
        } else {
          charIndex = Math.min(phrase.length, charIndex + 1);
        }

        typingText.textContent = phrase.slice(0, charIndex);

        if (!isDeleting && charIndex === phrase.length) {
          isDeleting = true;
          setTimeout(type, 1000);
          return;
        }

        if (isDeleting && charIndex === 0) {
          isDeleting = false;
          phraseIndex = (phraseIndex + 1) % typingPhrases.length;
          setTimeout(type, 250);
          return;
        }

        setTimeout(type, isDeleting ? 45 : 70);
      };

      type();
    }

    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');

    if (hamburger && mobileMenu) {
      hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('open');
        mobileMenu.classList.toggle('open');
      });

      document.querySelectorAll('.mobile-link').forEach(link => {
        link.addEventListener('click', () => {
          hamburger.classList.remove('open');
          mobileMenu.classList.remove('open');
        });
      });

      document.addEventListener('click', (e) => {
        if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
          hamburger.classList.remove('open');
          mobileMenu.classList.remove('open');
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
  });